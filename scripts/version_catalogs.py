"""Refresh the shared catalogue URL on its consumer pages."""
import argparse
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGES = ('index.html', 'journal.html', 'homework.html', 'progress.html')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    version = hashlib.sha256((ROOT / 'assets/catalogs.js').read_bytes()).hexdigest()[:12]
    pattern = r'assets/catalogs\.js\?v=[a-f0-9]+'
    for name in PAGES:
        path = ROOT / name
        source = path.read_text()
        updated, count = re.subn(pattern, 'assets/catalogs.js?v=' + version, source)
        if count != 1:
            raise SystemExit(f'{name}: expected one shared catalogue script')
        if args.check and updated != source:
            raise SystemExit('Catalogue URLs are stale: run python3 scripts/version_catalogs.py')
        if not args.check and updated != source:
            path.write_text(updated)
    print('PASS: all catalogue URLs match the shared file' if args.check else 'Updated catalogue URLs')


if __name__ == '__main__':
    main()
