#!/usr/bin/env python3
"""Fetch Yahoo Finance reference quotes for Backpack-listed securities and
bake them into dashboard/app.js + docs/app.js between STOCK_QUOTES markers.
Run from the repo root: ./build-quotes.py  (then mirror dashboard/ -> docs/)"""
import json, time, urllib.request, re, sys, datetime, os

SYMS = ["SPCX","MU","SNDK","BA","BABA","COST","DELL","DJT","HIMS","IBM","JNJ",
        "LMT","LULU","MGM","PFE","QUBT","RBLX","RDDT","RIVN","SHOP","SNAP","UPS","BULL"]
NAMES = {"SPCX":"SpaceX","MU":"Micron Tech","SNDK":"SanDisk","BA":"Boeing","BABA":"Alibaba",
 "COST":"Costco","DELL":"Dell","DJT":"Trump Media","HIMS":"Hims & Hers","IBM":"IBM",
 "JNJ":"Johnson & Johnson","LMT":"Lockheed Martin","LULU":"Lululemon","MGM":"MGM Resorts",
 "PFE":"Pfizer","QUBT":"Quantum Computing","RBLX":"Roblox","RDDT":"Reddit","RIVN":"Rivian",
 "SHOP":"Shopify","SNAP":"Snap","UPS":"UPS","BULL":"Webull"}

def fetch(sym):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=2d"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    m = json.load(urllib.request.urlopen(req, timeout=15))["chart"]["result"][0]["meta"]
    return {"sym": sym, "name": NAMES[sym],
            "px": round(m["regularMarketPrice"], 2),
            "chgPct": round(m.get("regularMarketChangePercent") or 0, 2)}

def main():
    quotes = []
    for s in SYMS:
        try:
            q = fetch(s); quotes.append(q)
            print(f"{s:5} {q['px']:>10}  {q['chgPct']:+.2f}%")
        except Exception as e:
            print(f"{s:5} FAILED: {e}", file=sys.stderr); sys.exit(1)
        time.sleep(0.4)
    ts = datetime.datetime.now(datetime.timezone.utc).astimezone(
        datetime.timezone(datetime.timedelta(hours=-4))).strftime("%Y-%m-%d %H:%M ET")
    lines = []
    for q in quotes:
        lines.append('  { sym: "%s", name: "%s", px: %s, chgPct: %s },' % (q["sym"], q["name"], q["px"], q["chgPct"]))
    block = ("/* __STOCK_QUOTES_START__ */\n"
             f"// Backpack Securities listings — UNDERLYING equity reference quotes (Yahoo Finance),\n"
             f"// baked {ts}. The onchain tokens are 1:1-backed by these shares; this tape shows the\n"
             f"// reference price, not a live onchain quote.\n"
             f'const STOCK_QUOTES_TS = "{ts}";\n'
             "const STOCK_QUOTES = [\n" + "\n".join(lines) + "\n];\n"
             "/* __STOCK_QUOTES_END__ */")
    root = os.path.dirname(os.path.abspath(__file__))
    # dashboard/ only — docs/ is produced by mirroring dashboard/ -> docs/
    for rel in ("dashboard/app.js",):
        path = os.path.join(root, rel)
        src = open(path).read()
        new, n = re.subn(r"/\* __STOCK_QUOTES_START__ \*/.*?/\* __STOCK_QUOTES_END__ \*/",
                         block, src, flags=re.S)
        if n != 1:
            print(f"marker not found exactly once in {path}", file=sys.stderr); sys.exit(1)
        open(path, "w").write(new)
        print(f"updated {path}")

if __name__ == "__main__":
    main()
