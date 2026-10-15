# -*- coding: utf-8 -*-
"""SEC-01..05: в открытых файлах сайта нет учительского содержимого. Запуск: python3 tests/static_check.py <папка сайта> [ключ]"""
import os, re, sys, zipfile, json

root = sys.argv[1]
key = sys.argv[2] if len(sys.argv) > 2 else None
MARKERS = ['Как объяснять', 'Типичная ошибка', 'Решение и ответ', 'teacher ans', 'Критерии', 
           'объясняю с нуля', 'Покажите ученику', 'Часть А — по 1 баллу', 'test-geo1.html',
           '→ одной прямой', 'В &nbsp;/&nbsp; Н <span class="teacher']
res = []
leaks = []
for d, _, fs in os.walk(root):
    if '/.git' in d:
        continue
    for f in fs:
        p = os.path.join(d, f)
        if f.endswith(('.html', '.js', '.css', '.md', '.json', '.txt')):
            s = open(p, encoding='utf-8', errors='ignore').read()
            for m in MARKERS:
                if m in s and not (f == 'test-plan.md' or f == 'bugs.md' or f == 'static_check.py' or f == 'e2e.js' or f == 'results.json'):
                    leaks.append(f'{os.path.relpath(p, root)}: «{m}»')
            if key and key in s:
                leaks.append(f'{os.path.relpath(p, root)}: КЛЮЧ')
        if f.endswith('.pdf') and re.search(r'teacher|test-|solutions|lecture-1', f):
            leaks.append(f'{os.path.relpath(p, root)}: учительский PDF в открытом виде')
res.append({'id': 'SEC-01', 'ok': not leaks, 'note': '; '.join(leaks[:10])})

ans = []
for n in range(1, 6):
    s = open(f'{root}/ws{n}.html', encoding='utf-8').read()
    if 'ans' in re.findall(r'class="([^"]*)"', s).__str__() or '→ ' in s:
        ans.append(f'ws{n}')
res.append({'id': 'SEC-02', 'ok': not ans, 'note': ', '.join(ans)})

notes = []
for f in os.listdir(f'{root}/files'):
    if f.endswith('.pptx'):
        z = zipfile.ZipFile(f'{root}/files/{f}')
        txt = b''.join(z.read(n) for n in z.namelist() if n.startswith('ppt/notesSlides/') and n.endswith('.xml'))
        if re.search(rb'<a:t>[^<]+</a:t>', txt):
            notes.append(f)
res.append({'id': 'SEC-03', 'ok': not notes, 'note': ', '.join(notes)})

# SEC-04: на страницах самопроверки нет ключей ответов, файлов с ключами в сайте нет
qk = []
for f in os.listdir(root):
    if f.startswith('quiz-') and f.endswith('.html'):
        s = open(f'{root}/{f}', encoding='utf-8').read()
        if re.search(r'edu_quiz_keys|data-key|"key"\s*:|\bkey\s*:', s):
            qk.append(f)
    if f.endswith('.sql') or 'quiz_keys' in f:
        qk.append(f)
res.append({'id': 'SEC-04', 'ok': not qk, 'note': ', '.join(qk)})

# SEC-05: в банке заданий ЕГЭ открыты только условия — ответов и решений нет ни в одном файле сайта
bk = []
s = open(f'{root}/ege-bank.html', encoding='utf-8').read()
if re.search(r'"(answer|solution|sol|a)"\s*:', s):
    bk.append('ege-bank.html: поле ответа')
bank = os.environ.get('BANK_KEYS')
if bank:
    B = json.load(open(bank, encoding='utf-8')); B = B.values() if isinstance(B, dict) else B
    sols = [re.sub(r'<[^>]+>', '', x['solution'])[:45] for x in B]
    for d, _, fs in os.walk(root):
        if '/.git' in d:
            continue
        for f in fs:
            if f.endswith(('.html', '.js', '.json', '.md', '.txt', '.svg')):
                t = re.sub(r'<[^>]+>', '', open(os.path.join(d, f), encoding='utf-8', errors='ignore').read())
                hit = [x for x in sols if x in t]
                if hit:
                    bk.append(f'{f}: решение «{hit[0][:25]}…»')
else:
    bk.append('нет BANK_KEYS — проверка решений не выполнена')
res.append({'id': 'SEC-05', 'ok': not bk, 'note': '; '.join(bk[:5])})

for r in res:
    print(('PASS ' if r['ok'] else 'FAIL ') + r['id'] + (' — ' + r['note'] if r['note'] else ''))
json.dump(res, open(os.path.join(os.path.dirname(__file__), 'static_results.json'), 'w'), ensure_ascii=False, indent=1)
