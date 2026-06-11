import os
import json
import uuid
import secrets
import threading
import urllib.request
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse, parse_qs

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR") or ("/tmp/cabinet-election-data" if os.environ.get("VERCEL") else ROOT / "data"))
DATA_DIR.mkdir(exist_ok=True)
CANDIDATES_FILE = DATA_DIR / "candidates.json"
VOTES_FILE = DATA_DIR / "votes.json"

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

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or ""
ADMIN_PATH = os.environ.get("ADMIN_PATH") or "/admin-portal-2026"

def load_json(file_path, default):
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
    with open(file_path, "w") as f:
        json.dump(data, f, indent=2)

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
            self.send_json({
                "votes": votes,
                "candidates": candidates
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
                self.send_error_json("This Roll No. has already voted.", 403)
                return

            votes_ledger[voter_id] = {
                "voterName": voter_name,
                "house": election_scope,
                "section": section,
                "roleNo": role_no,
                "votes": v_votes,
                "timestamp": int(uuid.uuid1().time / 10)
            }
            save_json(VOTES_FILE, votes_ledger)
            
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
                self.send_json({"token": token, "adminPath": ADMIN_PATH})
                return
            else:
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
            self.send_json({"success": True, "id": c_id})
            return

        if path == "/api/admin/candidates/delete":
            c_id = data.get("id", "")
            candidates = load_json(CANDIDATES_FILE, {})
            if c_id in candidates:
                del candidates[c_id]
                save_json(CANDIDATES_FILE, candidates)
                self.send_json({"success": True})
            else:
                self.send_error_json("Candidate not found", 404)
            return

        if path == "/api/admin/reset-votes":
            save_json(VOTES_FILE, {})
            self.send_json({"success": True})
            return

        if path == "/api/admin/reset-all":
            save_json(CANDIDATES_FILE, {})
            save_json(VOTES_FILE, {})
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
