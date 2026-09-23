#!/usr/bin/env python3
"""Fetch Yahoo Finance reference quotes for the Backpack Securities universe and
bake them into dashboard/app.js between STOCK_QUOTES markers.

The baked quotes are FALLBACK only — the browser upgrades to live onchain quotes
per token mint via Jupiter's price API (refreshLiveQuotes). Mints below were
resolved via Jupiter's token search (name contains "Backpack Securities").

SKHY (SK Hynix) trades in KRW on Yahoo; its ref is baked as null and the live
quote is the only mark.

Run from the repo root: ./build-quotes.py  (then mirror dashboard/ -> docs/)"""
import json, time, urllib.request, re, sys, datetime, os

MINTS = {
 "SPCX": "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb",
 "MU":   "MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1",
 "SNDK": "SNDKbwMUQvZhnLnxLduradgLHG5KrPuKwpnrkkGRhfH",
 "BA":   "BArimz1PcKZr8PcPh3tcZ2dg4S7FJLk3cw6R5F8GsHKg",
 "BABA": "BABANGA4JE7Kkam4nTrALAwAVgsNJUuFJnnkF7S16BZp",
 "COST": "CZEB3WNZuF2Yz1z2H81RcCk8T7fsw82KB33zqamASVsg",
 "DELL": "DELL2aRKQz7DMq5DrKLtkn47ZCnbxXPZXrSGbkmd13wy",
 "DJT":  "DJTu7vi8norVzdVAffgvb39VP7wjKeTsgaMBJrzfxvoF",
 "HIMS": "HiMSSzzwkZkrXJ4PGVJRdtfLaANeAztjjcgk5Dxe7Lwx",
 "IBM":  "BMKdM4yUxX12moFqVk195k7coMbaybd4RUKCUdm7D1Sk",
 "JNJ":  "JNJg1znKdF712Phe7L7z52AATAvEjEytBdN2w8Lnh1Y",
 "LMT":  "LMT3i1BHgixFqPUgcyteJhnEz2dpy9i3cYy4pi9BoeV",
 "LULU": "LULUmT9VMttkfAJE236LXJcYJ2tTP7nunrSWR5G1BdS",
 "MGM":  "MGMuubtUEirmkhfEQdmGUh4pr7HuUdMWcZXFtpPbVJD",
 "PFE":  "PFER6ENqP8r8NF3CqVt4mFowxsin3V5MLidBNQFCC3x",
 "QUBT": "QUBTAD8C9bMU9LvmMNgKPhrmBGbHvxpu6vfWQtThxxw",
 "RBLX": "RBLXDGRD64AtRamHMFVcjqne3Ar7NLWtFtYNtsrf1cE",
 "RDDT": "RDDTGbhHwVXfyCvQMXzzowKjf5qrYBZAnehoXW83ooh",
 "RIVN": "RcZmt84VMJv9bDhKqmw1uWDahYrUT468VwAChTnfD8p",
 "SHOP": "SH55hfaipFAbwT42nQYhRoM5o5t61QpkmJ6p62vXB3m",
 "SNAP": "SNAPcESrvnH8yUdgeMF6xm1hym9b6hW6s8YeqeHdZFz",
 "UPS":  "UPSqUeMHcWbkdg784XuBUEF9DtySSnW9ur5LAVdcuB9",
 "BULL": "BULL151gUXcFV5wXEUqu9Am2L7Qt4bTJRLRuAUjkcspC",
 "SKHY": "SKHYhSjuRWHgikq8eRKbtBbpABgJSkd7ytQV14i9EQ3",
 "CRWV": "CRWVJeR2yEZuDUKYfGuKCHvLz8ywn4LGvovHfy5WiFmi",
 "COPX": "CzLTZppPdZtTjyq3WGpHLstoc3GLhu7zH5Zg6xUa6Gv5",
 "TTWO": "TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo",
 "DKNG": "DKNGQFNGQmoBdXSRGKJ8tTu7uPDasw5JDcfMmWniNfow",
 "CYPH": "CYPHuMmCL1GxJWa2tsPhLKykC7GrHJTCHwbXD4g5uawK",
 "IONQ": "NQ5hSuXQZrbnrwcDVk2qN73njjd3E3v3badYHnj5thF",
 "BOT":  "BoTx8y9ynfdxf5ZjWtCoBVkff52qKA82ysaLU8ZM6d8T",
 "URA":  "URARfsinxCRw4JpvQhuT4CxavdZXZEMjv9ZwWmWpwag",
 "MSTR": "MSTRdWXMeZxdE8osAQy3fA4rvTY5rgummDSMEx6U7Nz",
 "AMD":  "AMD8XwJXgQ9WV45Wyj9yFLejxzf2J6VM1PJY8bJEjeES",
}
NAMES = {"SPCX":"SpaceX","MU":"Micron Tech","SNDK":"SanDisk","BA":"Boeing","BABA":"Alibaba",
 "COST":"Costco","DELL":"Dell","DJT":"Trump Media","HIMS":"Hims & Hers","IBM":"IBM",
 "JNJ":"Johnson & Johnson","LMT":"Lockheed Martin","LULU":"Lululemon","MGM":"MGM Resorts",
 "PFE":"Pfizer","QUBT":"Quantum Computing","RBLX":"Roblox","RDDT":"Reddit","RIVN":"Rivian",
 "SHOP":"Shopify","SNAP":"Snap","UPS":"UPS","BULL":"Webull","SKHY":"SK Hynix",
 "CRWV":"CoreWeave","COPX":"GX Copper Miners","TTWO":"Take-Two","DKNG":"DraftKings",
 "CYPH":"Cypherpunk Tech","IONQ":"IonQ","BOT":"RoboStrategy","URA":"GX Uranium ETF",
 "MSTR":"Strategy","AMD":"AMD"}
# Yahoo symbols that differ from the token ticker, or None to bake a null ref.
YAHOO = {"SKHY": None}

def fetch(sym):
    y = YAHOO.get(sym, sym)
    if y is None:
        return {"sym": sym, "name": NAMES[sym], "px": None, "chgPct": None}
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{y}?interval=1d&range=2d"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    m = json.load(urllib.request.urlopen(req, timeout=15))["chart"]["result"][0]["meta"]
    return {"sym": sym, "name": NAMES[sym],
            "px": round(m["regularMarketPrice"], 2),
            "chgPct": round(m.get("regularMarketChangePercent") or 0, 2)}

def main():
    quotes = []
    for s in MINTS:
        try:
            q = fetch(s); quotes.append(q)
            px = "null" if q["px"] is None else f"{q['px']:>10}"
            print(f"{s:5} {px}  {(q['chgPct'] or 0):+.2f}%")
        except Exception as e:
            print(f"{s:5} FAILED: {e}", file=sys.stderr); sys.exit(1)
        time.sleep(0.4)
    ts = datetime.datetime.now(datetime.timezone.utc).astimezone(
        datetime.timezone(datetime.timedelta(hours=-4))).strftime("%Y-%m-%d ~%H:%M ET")
    lines = []
    for q in quotes:
        px = "null" if q["px"] is None else q["px"]
        chg = "null" if q["chgPct"] is None else q["chgPct"]
        lines.append('  { sym: "%s", name: "%s", mint: "%s", px: %s, chgPct: %s },' % (
            q["sym"], q["name"], MINTS[q["sym"]], px, chg))
    block = ("/* __STOCK_QUOTES_START__ */\n"
             "// Backpack Securities listings — UNDERLYING equity reference quotes (Yahoo Finance),\n"
             f"// baked {ts}. In the browser these are upgraded to LIVE onchain\n"
             "// quotes per token mint via Jupiter's price API (refreshLiveQuotes); refs remain\n"
             "// as fallback when the quote feed is unreachable. Tokens are 1:1-backed by the shares.\n"
             f'const STOCK_QUOTES_TS = "{ts}";\n'
             "const STOCK_QUOTES = [\n" + "\n".join(lines) + "\n];\n"
             "/* __STOCK_QUOTES_END__ */")
    root = os.path.dirname(os.path.abspath(__file__))
    # dashboard/ only — docs/ is produced by mirroring dashboard/ -> docs/
    path = os.path.join(root, "dashboard/app.js")
    src = open(path).read()
    new, n = re.subn(r"/\* __STOCK_QUOTES_START__ \*/.*?/\* __STOCK_QUOTES_END__ \*/",
                     block, src, flags=re.S)
    if n != 1:
        print("marker not found exactly once in dashboard/app.js", file=sys.stderr); sys.exit(1)
    open(path, "w").write(new)
    print(f"updated {path} ({len(quotes)} tickers)")

if __name__ == "__main__":
    main()
