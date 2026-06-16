import os
import json
import uuid
import secrets
import threading
import hashlib
import urllib.request
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse, parse_qs

ROOT = Path(__file__).resolve().parent

def load_env():
    env_path = ROOT / ".env"
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    os.environ[key] = val

load_env()

DATA_DIR = Path(os.environ.get("DATA_DIR") or ("/tmp/cabinet-election-data" if os.environ.get("VERCEL") else ROOT / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
CANDIDATES_FILE = DATA_DIR / "candidates.json"
VOTES_FILE = DATA_DIR / "votes.json"
AUDIT_LOG_FILE = DATA_DIR / "audit_log.jsonl"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or ""
ADMIN_PATH = os.environ.get("ADMIN_PATH") or "/admin-portal-2026"

REDIS_JSON_KEYS = {
    "candidates.json": "candidates",
    "votes.json": "votes",
    "audit_log.jsonl": "audit_log"
}
REDIS_KEY_PREFIX = os.environ.get("REDIS_KEY_PREFIX") or os.environ.get("STORAGE_KEY_PREFIX") or "cabinet-election"

def redis_url():
    return (
        os.environ.get("REDIS_URL")
        or os.environ.get("STORAGE_URL")
        or os.environ.get("KV_URL")
        or os.environ.get("UPSTASH_REDIS_URL")
    )

def redis_rest_config():
    url = (
        os.environ.get("UPSTASH_REDIS_REST_URL")
        or os.environ.get("KV_REST_API_URL")
        or os.environ.get("STORAGE_REST_API_URL")
    )
    token = (
        os.environ.get("UPSTASH_REDIS_REST_TOKEN")
        or os.environ.get("KV_REST_API_TOKEN")
        or os.environ.get("STORAGE_REST_API_TOKEN")
    )
    return url, token

class RedisStore:
    def __init__(self):
        self.client = None
        self.rest_url, self.rest_token = redis_rest_config()
        url = redis_url()
        if url:
            try:
                import redis
            except ImportError as exc:
                raise RuntimeError("Redis URL found, but the redis Python package is not installed.") from exc
            self.client = redis.Redis.from_url(url, decode_responses=True)

    @property
    def enabled(self):
        return bool(self.client or (self.rest_url and self.rest_token))

    def key(self, file_path):
        suffix = REDIS_JSON_KEYS.get(Path(file_path).name, Path(file_path).name)
        return f"{REDIS_KEY_PREFIX}:{suffix}"

    def get_text(self, key):
        if self.client:
            return self.client.get(key)
        return self.rest_command("GET", key)

    def set_text(self, key, value):
        if self.client:
            self.client.set(key, value)
            return
        self.rest_command("SET", key, value)

    def rest_command(self, *parts):
        payload = json.dumps(list(parts)).encode("utf-8")
        req = urllib.request.Request(
            self.rest_url,
            data=payload,
            headers={
                "Authorization": f"Bearer {self.rest_token}",
                "Content-Type": "application/json"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=8) as response:
            body = json.loads(response.read().decode("utf-8"))
        if "error" in body and body["error"]:
            raise RuntimeError(f"Redis error: {body['error']}")
        return body.get("result")

REDIS_STORE = RedisStore()

def load_json(file_path, default):
    if REDIS_STORE.enabled:
        raw = REDIS_STORE.get_text(REDIS_STORE.key(file_path))
        if raw in (None, ""):
            REDIS_STORE.set_text(REDIS_STORE.key(file_path), json.dumps(default))
            return default
        try:
            return json.loads(raw)
        except Exception:
            return default

    if not file_path.exists():
        with open(file_path, "w") as f:
            json.dump(default, f)
        return default
    try:
        with open(file_path, "r") as f:
            return json.load(f)
    except Exception:
        return default

def save_json(file_path, data):
    if REDIS_STORE.enabled:
        REDIS_STORE.set_text(REDIS_STORE.key(file_path), json.dumps(data, indent=2))
        return

    with open(file_path, "w") as f:
        json.dump(data, f, indent=2)

def canonical_json(data):
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def sha256_text(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def compute_results_hash(candidates=None, votes=None):
    candidates = candidates if candidates is not None else load_json(CANDIDATES_FILE, {})
    votes = votes if votes is not None else load_json(VOTES_FILE, {})
    return sha256_text(canonical_json({
        "candidates": candidates,
        "votes": votes
    }))

def normalize_imported_candidates(raw_candidates):
    if isinstance(raw_candidates, dict):
        incoming = list(raw_candidates.values())
    elif isinstance(raw_candidates, list):
        incoming = raw_candidates
    else:
        raise ValueError("Nominee list must be an object or array.")

    allowed_roles = {
        "head_boy",
        "head_girl",
        "assistant_head_boy",
        "assistant_head_girl",
        "sports_captain_boy",
        "sports_captain_girl",
        "vice_sports_captain_boy",
        "vice_sports_captain_girl",
        "cultural_secretary_boy",
        "cultural_secretary_girl"
    }
    normalized = {}

    for item in incoming:
        if not isinstance(item, dict):
            continue

        name = str(item.get("name", "")).strip()
        role = str(item.get("role", "")).strip()
        if not name or role not in allowed_roles:
            continue

        c_id = str(item.get("id", "")).strip()
        if not c_id or c_id in normalized:
            c_id = f"c_{secrets.token_hex(8)}"

        photo = item.get("photo", None)
        if photo is not None and not isinstance(photo, str):
            photo = None

        normalized[c_id] = {
            "id": c_id,
            "name": name,
            "roleNo": str(item.get("roleNo", "") or ""),
            "role": role,
            "house": str(item.get("house", "cabinet") or "cabinet"),
            "photo": photo
        }

    if not normalized:
        raise ValueError("No valid nominees found in file.")

    return normalized

def read_audit_entries():
    if REDIS_STORE.enabled:
        raw = REDIS_STORE.get_text(REDIS_STORE.key(AUDIT_LOG_FILE))
        if not raw:
            return []
        entries = []
        for line in raw.splitlines():
            line = line.strip()
            if line:
                entries.append(json.loads(line))
        return entries

    if not AUDIT_LOG_FILE.exists():
        return []
    entries = []
    with open(AUDIT_LOG_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            entries.append(json.loads(line))
    return entries

def audit_entry_hash(entry):
    unsigned = dict(entry)
    unsigned.pop("hash", None)
    return sha256_text(canonical_json(unsigned))

def append_audit_event(action, actor="system", details=None, candidates=None, votes=None):
    entries = read_audit_entries()
    prev_hash = entries[-1]["hash"] if entries else "GENESIS"
    entry = {
        "index": len(entries) + 1,
        "timestamp": datetime.now().isoformat() + "Z",
        "action": action,
        "actor": actor,
        "details": details or {},
        "resultsHash": compute_results_hash(candidates, votes),
        "prevHash": prev_hash
    }
    entry["hash"] = audit_entry_hash(entry)
    if REDIS_STORE.enabled:
        audit_key = REDIS_STORE.key(AUDIT_LOG_FILE)
        current = REDIS_STORE.get_text(audit_key) or ""
        REDIS_STORE.set_text(audit_key, current + canonical_json(entry) + "\n")
        return entry

    with open(AUDIT_LOG_FILE, "a", encoding="utf-8") as f:
        f.write(canonical_json(entry) + "\n")
    return entry

def verify_audit_log():
    if REDIS_STORE.enabled:
        entries = read_audit_entries()
        prev_hash = "GENESIS"
        for expected_index, entry in enumerate(entries, start=1):
            if entry.get("index") != expected_index:
                return {"valid": False, "entries": entries, "entryCount": len(entries), "lastHash": None, "message": f"Broken audit index at entry {expected_index}."}
            if entry.get("prevHash") != prev_hash:
                return {"valid": False, "entries": entries, "entryCount": len(entries), "lastHash": None, "message": f"Broken hash link at entry {expected_index}."}
            if entry.get("hash") != audit_entry_hash(entry):
                return {"valid": False, "entries": entries, "entryCount": len(entries), "lastHash": None, "message": f"Entry {expected_index} hash does not match its contents."}
            prev_hash = entry["hash"]

        return {
            "valid": True,
            "entries": entries,
            "entryCount": len(entries),
            "lastHash": entries[-1]["hash"] if entries else None,
            "message": "Audit chain verified."
        }

    if not AUDIT_LOG_FILE.exists():
        return {
            "valid": True,
            "entries": [],
            "entryCount": 0,
            "lastHash": None,
            "message": "No audit events recorded yet."
        }

    entries = []
    prev_hash = "GENESIS"
    try:
        with open(AUDIT_LOG_FILE, "r", encoding="utf-8") as f:
            for expected_index, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue
                entry = json.loads(line)
                entries.append(entry)
                if entry.get("index") != expected_index:
                    return {"valid": False, "entries": entries, "entryCount": len(entries), "lastHash": None, "message": f"Broken audit index at entry {expected_index}."}
                if entry.get("prevHash") != prev_hash:
                    return {"valid": False, "entries": entries, "entryCount": len(entries), "lastHash": None, "message": f"Broken hash link at entry {expected_index}."}
                if entry.get("hash") != audit_entry_hash(entry):
                    return {"valid": False, "entries": entries, "entryCount": len(entries), "lastHash": None, "message": f"Entry {expected_index} hash does not match its contents."}
                prev_hash = entry["hash"]
    except Exception as exc:
        return {"valid": False, "entries": entries, "entryCount": len(entries), "lastHash": None, "message": f"Audit log cannot be parsed: {exc}"}

    return {
        "valid": True,
        "entries": entries,
        "entryCount": len(entries),
        "lastHash": entries[-1]["hash"] if entries else None,
        "message": "Audit chain verified."
    }

sessions = set()

def send_discord_webhook(voter_name, section, role_no, election_scope, votes_dict):
    webhook_url = os.environ.get("DISCORD_WEBHOOK_URL")
    if not webhook_url:
        return

    candidates = load_json(CANDIDATES_FILE, {})
    votes_ledger = load_json(VOTES_FILE, {})

    role_labels = {
        "head_boy": "Head Boy",
        "head_girl": "Head Girl",
        "assistant_head_boy": "Assistant Head Boy",
        "assistant_head_girl": "Assistant Head Girl",
        "sports_captain_boy": "Sports Captain Boy",
        "sports_captain_girl": "Sports Captain Girl",
        "vice_sports_captain_boy": "Vice Sports Captain Boy",
        "vice_sports_captain_girl": "Vice Sports Captain Girl",
        "cultural_secretary_boy": "Cultural Secretary Boy",
        "cultural_secretary_girl": "Cultural Secretary Girl"
    }
    
    selections_str = []
    for r_id, c_id in votes_dict.items():
        role_name = role_labels.get(r_id, r_id)
        cand_name = candidates.get(c_id, {}).get("name", "Unknown Nominee")
        selections_str.append(f"• **{role_name}:** {cand_name}")
    
    ballot_value = "\n".join(selections_str) if selections_str else "*No selections*"

    tallies = {}
    for v in votes_ledger.values():
        for c_id in v.get("votes", {}).values():
            tallies[c_id] = tallies.get(c_id, 0) + 1

    roles_list = [
        ("head_boy", "Head Boy"),
        ("head_girl", "Head Girl"),
        ("assistant_head_boy", "Assistant Head Boy"),
        ("assistant_head_girl", "Assistant Head Girl"),
        ("sports_captain_boy", "Sports Captain Boy"),
        ("sports_captain_girl", "Sports Captain Girl"),
        ("vice_sports_captain_boy", "Vice Sports Captain Boy"),
        ("vice_sports_captain_girl", "Vice Sports Captain Girl"),
        ("cultural_secretary_boy", "Cultural Secretary Boy"),
        ("cultural_secretary_girl", "Cultural Secretary Girl")
    ]
    
    leaderboard_str = []
    for r_id, r_label in roles_list:
        role_cands = [c for c in candidates.values() if c.get("role") == r_id]
        if role_cands:
            role_cands.sort(key=lambda c: tallies.get(c.get("id"), 0), reverse=True)
            leader = role_cands[0]
            leader_votes = tallies.get(leader.get("id"), 0)
            leaderboard_str.append(f"• **{r_label}:** {leader.get('name')} ({leader_votes} votes)")
    
    leaderboard_value = "\n".join(leaderboard_str) if leaderboard_str else "*No cabinet nominees yet*"
    total_ballots = len(votes_ledger)

    embed = {
        "title": "New Vote Recorded Successfully",
        "description": "Voter registered and votes received for **Cabinet Election**.",
        "color": 4021503,
        "fields": [
            {
                "name": "👤 Voter Details",
                "value": f"**Name:** {voter_name}\n**Class & Section:** {section}\n**Roll No:** {role_no}\n**Election:** Cabinet",
                "inline": True
            },
            {
                "name": "📊 Total Votes Cast",
                "value": f"`{total_ballots}` Votes received to date",
                "inline": True
            },
            {
                "name": "📝 Ballot Selections",
                "value": ballot_value,
                "inline": False
            },
            {
                "name": "🏆 Current Cabinet Standings",
                "value": leaderboard_value,
                "inline": False
            }
        ],
        "footer": {
            "text": "CABINET ELECTIONS 2026"
        },
        "timestamp": datetime.now().isoformat() + "Z"
    }

    payload = {
        "embeds": [embed]
    }

    req = urllib.request.Request(
        webhook_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            pass
    except Exception as e:
        print(f"Failed to send discord webhook: {e}")


class AppHandler(SimpleHTTPRequestHandler):
    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def send_error_json(self, message, status=400):
        self.send_json({"error": message}, status)

    def check_admin_auth(self):
        auth_header = self.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return False
        token = auth_header.split(" ")[1]
        return token in sessions

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path in ("/", "/index.html", ADMIN_PATH):
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.end_headers()
            with open(ROOT / "index.html", "rb") as f:
                self.wfile.write(f.read())
            return

        if path == "/api/candidates":
            candidates = load_json(CANDIDATES_FILE, {})
            self.send_json(candidates)
            return

        if path == "/api/check-voted":
            params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
            voter_id = params.get("voterId", "")
            if not voter_id:
                self.send_error_json("Missing voterId", 400)
                return
            votes_ledger = load_json(VOTES_FILE, {})
            self.send_json({"voted": voter_id in votes_ledger})
            return

        if path == "/api/admin/results":
            if not self.check_admin_auth():
                self.send_error_json("Unauthorized", 401)
                return
            votes = load_json(VOTES_FILE, {})
            candidates = load_json(CANDIDATES_FILE, {})
            audit = verify_audit_log()
            current_results_hash = compute_results_hash(candidates, votes)
            last_results_hash = audit["entries"][-1].get("resultsHash") if audit["entries"] else current_results_hash
            self.send_json({
                "votes": votes,
                "candidates": candidates,
                "integrity": {
                    "auditValid": audit["valid"],
                    "resultsValid": audit["valid"] and current_results_hash == last_results_hash,
                    "currentResultsHash": current_results_hash,
                    "lastLoggedResultsHash": last_results_hash,
                    "lastAuditHash": audit["lastHash"],
                    "auditEntryCount": audit["entryCount"],
                    "message": audit["message"] if audit["valid"] else audit["message"]
                }
            })
            return

        if path == "/api/admin/audit":
            if not self.check_admin_auth():
                self.send_error_json("Unauthorized", 401)
                return
            audit = verify_audit_log()
            current_results_hash = compute_results_hash()
            last_results_hash = audit["entries"][-1].get("resultsHash") if audit["entries"] else current_results_hash
            self.send_json({
                "valid": audit["valid"],
                "resultsValid": audit["valid"] and current_results_hash == last_results_hash,
                "message": audit["message"],
                "entryCount": audit["entryCount"],
                "lastHash": audit["lastHash"],
                "currentResultsHash": current_results_hash,
                "lastLoggedResultsHash": last_results_hash,
                "entries": audit["entries"][-100:]
            })
            return

        requested = unquote(path).lstrip("/")
        target = (ROOT / requested).resolve()

        try:
            target.relative_to(ROOT)
            if target.is_file():
                self.path = "/" + str(target.relative_to(ROOT)).replace("\\", "/")
                super().do_GET()
                return
        except ValueError:
            pass

        self.send_response(404)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"404 Not Found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        
        try:
            data = json.loads(post_data.decode('utf-8')) if post_data else {}
        except Exception:
            self.send_error_json("Invalid JSON payload", 400)
            return

        if path == "/api/vote":
            voter_name = data.get("voterName", "").strip()
            section = data.get("section", "").strip()
            role_no = data.get("roleNo", "").strip()
            election_scope = data.get("house", "cabinet").strip() or "cabinet"
            v_votes = data.get("votes", {})

            if not voter_name or not section or not role_no or not v_votes:
                self.send_error_json("Missing required fields", 400)
                return

            voter_id = f"{election_scope}_{role_no}"
            
            votes_ledger = load_json(VOTES_FILE, {})
            if voter_id in votes_ledger:
                append_audit_event("duplicate_vote_blocked", "voter", {
                    "voterId": voter_id
                }, votes=votes_ledger)
                self.send_error_json("This Roll No. has already voted.", 403)
                return

            vote_record = {
                "voterName": voter_name,
                "house": election_scope,
                "section": section,
                "roleNo": role_no,
                "votes": v_votes,
                "timestamp": int(uuid.uuid1().time / 10)
            }
            votes_ledger[voter_id] = vote_record
            save_json(VOTES_FILE, votes_ledger)
            append_audit_event("vote_submitted", "voter", {
                "voterId": voter_id,
                "ballotHash": sha256_text(canonical_json(vote_record))
            }, votes=votes_ledger)
            
            if os.environ.get("DISCORD_WEBHOOK_URL"):
                threading.Thread(
                    target=send_discord_webhook,
                    args=(voter_name, section, role_no, election_scope, v_votes),
                    daemon=True
                ).start()

            self.send_json({"success": True})
            return

        if path == "/api/admin/login":
            password = data.get("password", "")
            if password == ADMIN_PASSWORD:
                token = secrets.token_hex(32)
                sessions.add(token)
                append_audit_event("admin_login_success", "admin", {})
                self.send_json({"token": token, "adminPath": ADMIN_PATH})
                return
            else:
                append_audit_event("admin_login_failed", "admin", {})
                self.send_error_json("Incorrect password", 401)
                return

        if not self.check_admin_auth():
            self.send_error_json("Unauthorized", 401)
            return

        if path == "/api/admin/candidates":
            name = data.get("name", "").strip()
            role = data.get("role", "").strip()
            house = data.get("house", "cabinet").strip() or "cabinet"
            photo = data.get("photo", None)

            if not name or not role:
                self.send_error_json("Missing name or role", 400)
                return

            candidates = load_json(CANDIDATES_FILE, {})
            c_id = f"c_{secrets.token_hex(8)}"
            candidates[c_id] = {
                "id": c_id,
                "name": name,
                "roleNo": "",
                "role": role,
                "house": house,
                "photo": photo
            }
            save_json(CANDIDATES_FILE, candidates)
            append_audit_event("candidate_added", "admin", {
                "candidateId": c_id,
                "role": role,
                "nameHash": sha256_text(name)
            }, candidates=candidates)
            self.send_json({"success": True, "id": c_id})
            return

        if path == "/api/admin/candidates/delete":
            c_id = data.get("id", "")
            candidates = load_json(CANDIDATES_FILE, {})
            if c_id in candidates:
                removed = candidates[c_id]
                del candidates[c_id]
                save_json(CANDIDATES_FILE, candidates)
                append_audit_event("candidate_deleted", "admin", {
                    "candidateId": c_id,
                    "role": removed.get("role"),
                    "nameHash": sha256_text(removed.get("name", ""))
                }, candidates=candidates)
                self.send_json({"success": True})
            else:
                self.send_error_json("Candidate not found", 404)
            return

        if path == "/api/admin/candidates/import":
            raw_candidates = data.get("candidates", data.get("nominees", data))
            try:
                candidates = normalize_imported_candidates(raw_candidates)
            except ValueError as exc:
                self.send_error_json(str(exc), 400)
                return

            save_json(CANDIDATES_FILE, candidates)
            append_audit_event("candidates_imported", "admin", {
                "candidateCount": len(candidates),
                "candidateIdsHash": sha256_text(canonical_json(sorted(candidates.keys())))
            }, candidates=candidates)
            self.send_json({"success": True, "count": len(candidates), "candidates": candidates})
            return

        if path == "/api/admin/reset-votes":
            save_json(VOTES_FILE, {})
            append_audit_event("votes_reset", "admin", {}, votes={})
            self.send_json({"success": True})
            return

        if path == "/api/admin/reset-all":
            save_json(CANDIDATES_FILE, {})
            save_json(VOTES_FILE, {})
            append_audit_event("system_reset", "admin", {}, candidates={}, votes={})
            self.send_json({"success": True})
            return

        self.send_error_json("Endpoint not found", 404)

    def log_message(self, format, *args):
        print("%s - %s" % (self.address_string(), format % args))


if __name__ == "__main__":
    port_value = os.environ.get("SERVER_PORT") or os.environ.get("P_SERVER_PORT") or os.environ.get("PORT")
    if not port_value:
        raise RuntimeError("No server port found. Set SERVER_PORT in your environment variables.")

    port = int(port_value)
    server = ThreadingHTTPServer(("0.0.0.0", port), AppHandler)
    print(f"Serving Cabinet Elections on port {port}")
    print(f"Secret Admin Portal path configured: {ADMIN_PATH}")
    server.serve_forever()
