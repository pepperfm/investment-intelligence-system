"""Read-only official CBR discovery; no credentials, no database writes."""
import json
import pathlib
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'tests/fixtures/cbr'
PROBES = {
    'publications': 'https://www.cbr.ru/dataservice/publications',
    'daily-wsdl': 'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx?WSDL',
    'daily-help': 'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx?op=KeyRateXML',
    'fx': 'https://www.cbr.ru/scripts/XML_daily.asp',
    'rss': 'https://www.cbr.ru/rss/RssPress',
    'banks-wsdl': 'https://www.cbr.ru/CreditInfoWebServ/CreditOrgInfo.asmx?WSDL',
    'finorg-doc': 'https://www.cbr.ru/development/finorg/',
}
results = []
for name, url in PROBES.items():
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'IIS/1.0 (personal research; read-only)'})
        with urllib.request.urlopen(req, timeout=15) as response:
            raw = response.read(4_000_001)
            if len(raw) > 4_000_000:
                raise ValueError('size limit')
            encoding = response.headers.get_content_charset() or ('windows-1251' if name == 'fx' else 'utf-8')
            body = raw.decode(encoding)
            ext = 'json' if name == 'publications' else 'xml'
            if name in ['finorg-doc', 'daily-help']:
                ext = 'html'
            (OUT / f'{name}.{ext}').write_text(body)
            results.append({'name': name, 'url': url, 'status': response.status, 'bytes': len(raw), 'checkedAt': datetime.now(timezone.utc).isoformat()})
    except Exception as error:
        results.append({'name': name, 'url': url, 'error': str(error), 'checkedAt': datetime.now(timezone.utc).isoformat()})
    print(json.dumps(results[-1], ensure_ascii=False), flush=True)
(ROOT / 'docs/data-sources/discovery.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
