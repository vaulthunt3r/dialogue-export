"""Independently verify the synthetic Firefox archive fixture with Python's ZIP reader."""
import json
import sys
import zipfile
from pathlib import Path
from urllib.parse import unquote
from html.parser import HTMLParser

folder = Path(sys.argv[1])
class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.links.extend(unquote(v) for k, v in attrs if k == 'href')

archives = sorted(folder.glob('*.zip'))
reports = sorted(folder.glob('*-report.json'))
partial_failure = '--partial-failure' in sys.argv
assert (len(archives), len(reports)) == ((1, 1) if partial_failure else (8, 4))
count = 0
for archive in archives:
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None, archive.name
        manifest = json.loads(z.read('manifest.json'))
        assert manifest['archive'] == archive.name
        assert manifest['imagesIncluded'] is False
        index = z.read('index.html').decode('utf-8')
        parser = Links()
        parser.feed(index)
        assert parser.links == [row['file'] for row in manifest['chats']]
        for row in manifest['chats']:
            text = z.read(row['file']).decode('utf-8')
            assert 'SYNTHETIC_PRIVATE_TOKEN' not in text and 'PRIVATE_HIDDEN_BRANCH' not in text
            assert row['id'] in text and 'Привет' in text and row['messages'] == 2
            if manifest['format'] == 'html':
                assert '<pre' in text and '<table' in text and '<img' not in text
            elif manifest['format'] == 'json':
                data = json.loads(text)
                assert [message['id'] for message in data['messages']] == ['u', 'a']
            elif manifest['format'] == 'md':
                assert '```python' in text and '    print("hello")' in text
            count += 1
for report_file in reports:
    report = json.loads(report_file.read_text(encoding='utf-8'))
    if partial_failure:
        assert report['saved'] == 36 and report['failed'] == 4 and report['notAttempted'] == 2 and report['notSaved'] == 2
        assert report['state'] == 'error' and report['errorCode'] == 'HTTP_502'
        assert [row['code'] for row in report['chats'] if row['status'] == 'failed'] == ['RESPONSE_UNFINISHED', 'RICH_REFERENCE', 'RICH_REFERENCE', 'HTTP_502']
        excluded = {26, 30, 31, 40, 41, 104}
        assert {int(row['id'].split('-')[-1]) for row in report['chats'] if row['status'] == 'saved'} == set(range(1, 42)) - excluded
    else:
        assert report['saved'] == 3 and report['failed'] == 1 and report['notSaved'] == 0
        assert report['state'] == 'partial'
    assert report['finishedAt']
    for row in report['chats']:
        if row['status'] == 'saved':
            with zipfile.ZipFile(folder / row['part']) as z:
                assert row['file'] in z.namelist()
assert count == (36 if partial_failure else 12)
print(json.dumps({'zipReader': 'Python zipfile', 'archives': len(archives), 'reports': len(reports), 'chatFiles': count, 'crc': 'pass', 'utf8': 'pass', 'links': 'pass', 'content': 'pass'}))
