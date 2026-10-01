"""Compare publicly deployed Hosting bytes with dist; no account or database access."""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
ORIGIN = "https://won-archive-weave.web.app"
ROUTES = ["/", "/resources", "/archive", "/calendar", "/calendar/new",
          "/contribute", "/community", "/profile", "/events/release-check"]


def check(item):
    route, expected = item
    request = urllib.request.Request(ORIGIN + urllib.parse.quote(route, safe="/"),
                                    headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=45) as response:
        actual = response.read()
        assert response.status == 200, route
        assert hashlib.sha256(actual).digest() == hashlib.sha256(expected).digest(), route
    return route


assets = [file for file in DIST.rglob("*") if file.is_file()
          and not any(part.startswith(".") for part in file.relative_to(DIST).parts)]
items = [(route, (DIST / "index.html").read_bytes()) for route in ROUTES]
items += [("/" + file.relative_to(DIST).as_posix(), file.read_bytes()) for file in assets]
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
    checked = list(executor.map(check, items))
print(json.dumps({"checked_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "origin": ORIGIN, "routes": len(ROUTES), "matching_files": len(assets),
                  "matching_js_css": sum(file.suffix in [".js", ".css"] for file in assets),
                  "status": "PASS", "scope": "public Hosting bytes only"}, indent=2))
