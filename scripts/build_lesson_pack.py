"""Build pupil pages and encrypted teacher packs from private authoring JSON.

Inputs and the content key must stay outside the public repository. Existing lessons
are used only as shell/client templates. No database writes are performed here.
"""
import argparse
import copy
import html
import hashlib
import json
import re
import subprocess
from pathlib import Path
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]
IDS = ('a18', 'ma26', 'g21', 'mg24')


def load(path):
    data=json.loads(path.read_text())
    if isinstance(data['quizzes'],dict):
        data['quizzes']=[data['quizzes']['class'],data['quizzes']['home']]
    if len(data['examples'])!=3 or any(len(data[k])!=6 for k in ('practice','homework')):
        raise ValueError('Expected 3 examples and 6+6 independent tasks')
    if len(data['quizzes'])!=2 or any(len(q)!=6 for q in data['quizzes']) or len(data['slides'])!=10:
        raise ValueError('Expected two 6-question quizzes and 10 slides')
    for quiz in data['quizzes']:
        for q in quiz:
            if 'options' in q and (len(q['options'])!=4 or q['answer'] not in 'abcd'):
                raise ValueError('Bad multiple choice question')
    return data


def assets(data):
    key=data['id'];suffix=key[1:] if re.fullmatch(r'g\d+',key) else key
    return 's'+suffix,'ws'+suffix


def head(page,title):
    template=(ROOT/'a17.html').read_text().split('</head>')[0]
    template=re.sub(r'<title>.*?</title>','<title>'+html.escape(title)+'</title>',template,count=1,flags=re.S)
    template=template.replace('dataset.page="a17"','dataset.page="'+page+'"')
    version=hashlib.sha256((ROOT/'assets/auth.js').read_bytes()).hexdigest()[:12]
    template=re.sub(r'assets/auth.js\?v=[^"]+', 'assets/auth.js?v='+version,template)
    template=re.sub(r'<meta name="description" content="[^"]*">','<meta name="description" content="'+html.escape(title,quote=True)+'">',template,count=1)
    return template+'<link rel="stylesheet" href="assets/lesson-pack.css?v=20261117-1">\n</head>'


def shell(page,title,body,script=''):
    template=(ROOT/'a17.html').read_text()
    header=template[template.index('<header'):template.index('</header>')+9]
    footer=template[template.index('<footer>'):template.index('</footer>')+9]
    header=nav(header, bool(re.match(r'^(g\d|mg\d|ws\d|wsmg\d)',page)))
    return head(page,title)+'<body>'+header+body+script+footer+'</body></html>\n'


def nav(content,geometry):
    content=content.replace('href="algebra.html" class="on"','href="algebra.html" class=""').replace('href="geometry.html" class="on"','href="geometry.html" class=""')
    target='geometry.html' if geometry else 'algebra.html'
    return content.replace('href="'+target+'" class=""','href="'+target+'" class="on"',1)


def meta(d):
    return '<p class="source">'+html.escape(d['book'])+' · страницы '+html.escape(d['source']['printedPages'])+'. Объяснения, примеры и задания подготовлены для урока.</p>'


def teacher_solutions(d):
    out='<section class="teacher-block" data-teacher-check="TEACHER-ONLY-'+d['id']+'-CONTENT"><h2>Материалы учителя</h2>'+d['teacherNotesHtml']
    for key,label in [('practice','Классная работа'),('homework','Домашнее задание')]:
        out+='<h3>'+label+': решения</h3>'
        for i,t in enumerate(d[key],1):out+='<div class="worked"><b>'+('П' if key=='practice' else 'Д')+str(i)+'</b><div>'+t['promptHtml']+'</div><div class="solution">'+t['solutionHtml']+'</div></div>'
    for variant,quiz in zip(('В классе','Домой'),d['quizzes']):
        out+='<h3>Самопроверка · '+variant+': разбор</h3>'
        for i,q in enumerate(quiz,1):
            answer=q['options']['abcd'.index(q['answer'])] if 'options' in q else html.escape(q['answer'])
            out+='<p><b>'+str(i)+'.</b> '+q['promptHtml']+'<br><b>Ответ:</b> '+answer+'</p>'+q['explanationHtml']
    out+='<h3>Заметки к слайдам</h3>'
    for i,slide in enumerate(d['slides'],1):out+='<p><b>'+str(i)+'. '+html.escape(slide['title'])+'</b> — '+html.escape(slide['notes'])+'</p>'
    return out+'</section>'


def lesson(d,teacher=False):
    sid,ws=assets(d);key=d['id']
    body='<main class="wrap narrow lesson-pack"><div class="kicker">'+html.escape(d['kicker'])+'</div><h1>'+html.escape(d['title'])+'</h1>'+meta(d)
    body+='<p>Урок на '+str(d['durationMinutes'])+' минут.</p><div class="goal"><b>После урока получится:</b><ul>'+''.join('<li>'+html.escape(g)+'</li>' for g in d['goals'])+'</ul></div>'
    body+='<p><b>Вспомнить перед началом:</b> '+html.escape('; '.join(item.rstrip('.; ') for item in d['prerequisites']))+'.</p>'
    body+='<nav class="lesson-links"><a class="pill" href="'+sid+'.html">Слайды</a><a class="pill" href="'+ws+'.html">Рабочий лист</a><a class="pill" href="quiz-'+key+'a.html">Тест в классе</a><a class="pill" href="quiz-'+key+'b.html">Тест домой</a></nav>'
    body+='<section id="theory"><h2>Теория</h2>'+d['theoryHtml']+'</section><section id="examples"><h2>Разбор примеров</h2>'
    for e in d['examples']:body+='<article class="worked"><h3>'+html.escape(e['title'])+'</h3>'+e['problemHtml']+'<div class="solution">'+e['solutionHtml']+'</div></article>'
    body+='</section><section id="practice"><h2>Задачи урока</h2>'
    for i,t in enumerate(d['practice'],1):body+='<article class="practice-task"><b>П'+str(i)+'.</b> '+t['promptHtml']+'</article>'
    body+='</section><section id="quiz"><h2>Тест к уроку</h2><p>После самостоятельной попытки вы увидите результат и правильные ответы.</p><a class="btn" href="quiz-'+key+'a.html">Начать самопроверку →</a></section><section id="homework"><h2>Домашнее задание</h2><p class="goal">Решите Д1–Д6 письменно; укажите условия применимости формул и обоснуйте каждый ответ.</p>'
    for i,t in enumerate(d['homework'],1):body+='<div class="task practice-task"><span class="task-no">Д'+str(i)+'.</span> '+t['promptHtml']+'</div>'
    body+='<p><a href="quiz-'+key+'b.html">Самопроверка к домашнему заданию →</a></p></section>'
    if teacher:body+=teacher_solutions(d)
    return body+'<div class="pager"><a href="'+d['previousId']+'.html">← Предыдущий урок</a><a href="'+d['indexPage']+'">Все уроки →</a></div></main>'


def quiz(d,variant):
    suffix='ab'[variant];qid='quiz-'+d['id']+suffix;label='в классе' if variant==0 else 'домой';questions=d['quizzes'][variant]
    template=(ROOT/'quiz-ma25a.html').read_text()
    template=template.replace('dataset.page="quiz-ma25a"','dataset.page="'+qid+'"')
    title=d['title']+' · самопроверка '+label
    template=re.sub(r'<title>.*?</title>','<title>'+html.escape(title)+'</title>',template,count=1,flags=re.S)
    template=re.sub(r'<h1[^>]*>.*?</h1>','<h1>'+html.escape(title)+'</h1>',template,count=1,flags=re.S)
    hero='<section class="hero"><div class="wrap narrow"><div class="kicker">'+html.escape(d['kicker'])+'</div><h1>'+html.escape(title)+'</h1><p class="lede">6 вопросов. После отправки попытки появятся результат и правильные ответы.</p></div></section>'
    template=re.sub(r'<section class="hero"[\s\S]*?</section>',lambda m:hero,template,count=1)
    # Only replace the questions, preserving the established submission/history client.
    start=template.index('<form id="qzForm">')+len('<form id="qzForm">');end=template.index('<div class="qz-bar">',start)
    form='';opts={}
    for n,q in enumerate(questions,1):
        form+='<div class="qz-q" data-q="'+str(n)+'"><div class="qz-n">Вопрос '+str(n)+'</div><div class="qz-t">'+q['promptHtml']+'</div>'
        if 'options' in q:
            opts[str(n)]=q['options'];form+='<div class="qz-opts">'+''.join('<label><input type="radio" name="q'+str(n)+'" value="'+letter+'"><span>'+value+'</span></label>' for letter,value in zip('abcd',q['options']))+'</div>'
        else:form+='<input type="text" name="q'+str(n)+'" autocomplete="off" aria-label="Ответ на вопрос '+str(n)+'">'
        form+='<div class="qz-res" hidden></div></div>'
    template=template[:start]+form+template[end:]
    template=re.sub(r'var QID = "quiz-ma25a", OPTS = .*?, K = window.KABINET',lambda m:'var QID = '+json.dumps(qid)+', OPTS = '+json.dumps(opts,ensure_ascii=False)+', K = window.KABINET',template,count=1)
    template=template.replace('quiz-ma25a.html',qid+'.html').replace('ma25.html',d['id']+'.html')
    labels={'algebra.html':'Алгебра · Алимов','algebra-m.html':'Алгебра · Мерзляк','geometry.html':'Геометрия · Атанасян','geometry-m.html':'Геометрия · Мерзляк'}
    crumb='<div class="crumbs"><a href="index.html">Главная</a> · <a href="'+d['indexPage']+'">'+labels[d['indexPage']]+'</a> · <a href="'+d['id']+'.html">'+html.escape(d['title'])+'</a> · Самопроверка</div>'
    template=re.sub(r'<div class="crumbs">.*?</div>',lambda m:crumb,template,count=1)
    template=nav(template,d['subject']=='Геометрия')
    version=hashlib.sha256((ROOT/'assets/auth.js').read_bytes()).hexdigest()[:12]
    template=re.sub(r'assets/auth.js\?v=[^"]+', 'assets/auth.js?v='+version,template)
    template=template.replace('§ 25','Урок').replace('Формулы приведения',d['title'])
    template=template.replace('</head>','<link rel="stylesheet" href="assets/lesson-pack.css?v=20261117-1"></head>')
    return template


def worksheet_parts(d,teacher=False):
    sid,ws=assets(d);old=(ROOT/'wsma25.html').read_text();script=old[old.rfind('<script>'):old.rfind('</script>')+9].replace("var WS = 'wsma25'","var WS = '"+ws+"'")
    styles=re.search(r'<style>\s*\.wsbar[\s\S]*?</style>',old).group(0)
    body='<main class="wrap narrow lesson-pack"><h1>Рабочий лист</h1><h2>'+html.escape(d['title'])+'</h2>'+meta(d)+'<div class="toolbar"><a class="pill" href="files/'+ws+'-student.pdf">Скачать PDF для печати</a></div>'+styles+'<div id="wsBar" class="wsbar no-print" hidden></div><div class="sheet"><p>Имя: ____________________ Дата: ______________</p><h3>Перед началом</h3><p>Главная идея урока: <span class="blank"></span></p><p>Условия, которые важно проверить: <span class="blank"></span></p><p>Мой вопрос к учителю: <span class="blank"></span></p><h3>Самостоятельная работа</h3>'
    for i,t in enumerate(d['practice'],1):body+='<section class="worksheet-task"><b>П'+str(i)+'.</b> '+t['promptHtml']+'<div class="lines"><div></div><div></div><div></div></div></section>'
    body+='<p>Что получилось уверенно? <span class="blank"></span></p></div>'
    if teacher:body+=teacher_solutions(d)+'<a class="pill" href="files/'+ws+'-teacher.pdf">Решения в PDF для учителя</a>'
    body+='<div class="pager"><a href="'+d['id']+'.html">← К уроку</a><a href="'+sid+'.html">Слайды →</a></div></main>'
    return body,script


def slides(d):
    sid,_=assets(d);body='<div id="stage"><div class="deck">'
    for i,s in enumerate(d['slides'],1):body+='<section class="slide"><div class="in"><div class="k">'+html.escape(d['kicker'])+' · '+str(i)+'/10</div><h2 class="h">'+html.escape(s['title'])+'</h2><div class="slide-body">'+s['bodyHtml']+'</div></div><div class="foot"><span>'+html.escape(d['subject'])+'</span><span>'+str(i)+' / 10</span></div></section>'
    body+='</div></div><div id="ui"><a href="'+d['id']+'.html">← К уроку</a><button id="prev">‹</button><span id="cnt"></span><button id="next">›</button><button id="fs">Во весь экран</button></div>'
    extra='<link rel="stylesheet" href="assets/slides.css?v=bea01f5c"><style>.slide .in{padding:38px 50px 42px}.slide .h{font-size:40px;margin-bottom:18px}.slide-body{font-size:25px;line-height:1.45}.slide-body p{margin:12px 0}.slide-body table{width:100%;border-collapse:collapse;font-size:22px}.slide-body td,.slide-body th{border:1px solid #b9a684;padding:7px}.slide-body svg{display:block;max-height:320px;max-width:100%;width:auto;margin:0 auto}.slide-body .fr{display:inline-flex;flex-direction:column;text-align:center;vertical-align:middle;line-height:1.1}.slide-body .fr>span:first-child{border-bottom:1px solid}.slide-body ul{margin:8px 0}.slide-body li{margin-bottom:8px}</style>'
    return head(sid,'Презентация · '+d['title']).replace('</head>',extra+'</head>')+'<body>'+body+'<script src="assets/slides.js?v=bea01f5c"></script></body></html>\n'


def print_sheet(d,teacher=False):
    label='Учитель: решения' if teacher else 'Рабочий лист'
    style='''@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#28233a;font-size:12pt;line-height:1.45;margin:0}h1{font-size:20pt;line-height:1.15;margin:0 0 10pt}h2{font-size:15pt;margin:10pt 0}h3{font-size:13pt}p{margin:7pt 0}.fr{display:inline-flex;flex-direction:column;text-align:center;vertical-align:middle;line-height:1.1}.fr>span:first-child{border-bottom:1px solid}.page{break-after:page}.page:last-child{break-after:auto}.task{margin:18pt 0;break-inside:avoid}.space{height:100pt;background:repeating-linear-gradient(white,white 23pt,#ddd 24pt)}.source{font-size:9pt;color:#666}svg{max-width:100%;max-height:180pt}.vec{font-weight:800}table{width:100%;border-collapse:collapse}td,th{border:1px solid #bbb;padding:5pt}'''
    body=''
    if teacher:
        for key,title in [('practice','Классная работа'),('homework','Домашнее задание')]:
            for start in range(0,6,2):
                body+='<section class="page"><h1>'+html.escape(d['title'])+'</h1><p>'+label+' · '+title+'</p>'
                for i,t in enumerate(d[key][start:start+2],start+1):body+='<div class="task"><h2>'+('П' if key=='practice' else 'Д')+str(i)+'</h2>'+t['promptHtml']+'<hr>'+t['solutionHtml']+'</div>'
                body+='</section>'
    else:
        for start in range(0,6,2):
            body+='<section class="page"><h1>'+html.escape(d['title'])+'</h1><p>'+label+' · '+html.escape(d['kicker'])+'</p><p>Имя: _____________________ Дата: ______________</p>'
            for i,t in enumerate(d['practice'][start:start+2],start+1):body+='<div class="task"><h2>П'+str(i)+'.</h2>'+t['promptHtml']+'<div class="space"></div></div>'
            body+='<p class="source">'+html.escape(d['book'])+' · стр. '+html.escape(d['source']['printedPages'])+'. Задания урока составлены отдельно.</p></section>'
    return '<!doctype html><html lang="ru"><meta charset="utf-8"><title>'+html.escape(d['title'])+'</title><style>'+style+'</style><body>'+body+'</body></html>'


def encrypt(data,keyfile,path,node):
    path.parent.mkdir(parents=True,exist_ok=True)
    # The key is read inside the child process; it never appears in command arguments.
    code="const fs=require('fs'),c=require('crypto');const key=Buffer.from(fs.readFileSync(process.argv[1],'utf8').trim(),'base64');if(key.length!==32)throw Error('Invalid key');const iv=c.randomBytes(12),enc=c.createCipheriv('aes-256-gcm',key,iv);const data=fs.readFileSync(0);fs.writeFileSync(process.argv[2],Buffer.concat([iv,enc.update(data),enc.final(),enc.getAuthTag()]));"
    subprocess.run([node,'-e',code,str(keyfile),str(path)],input=data,check=True,capture_output=True)


def main():
    p=argparse.ArgumentParser();p.add_argument('--input-dir',type=Path,required=True);p.add_argument('--key-file',type=Path,required=True);p.add_argument('--node',default='node');a=p.parse_args()
    for id in IDS:
        d=load(a.input_dir/(id+'.json'));sid,ws=assets(d)
        (ROOT/(id+'.html')).write_text(shell(id,d['title'],lesson(d)))
        (ROOT/(sid+'.html')).write_text(slides(d))
        body,script=worksheet_parts(d);(ROOT/(ws+'.html')).write_text(shell(ws,'Рабочий лист · '+d['title'],body,script))
        for variant,suffix in enumerate('ab'):(ROOT/('quiz-'+id+suffix+'.html')).write_text(quiz(d,variant))
        for page,title,content in [(id,d['title'],lesson(d,True)),(ws,'Рабочий лист · '+d['title'],worksheet_parts(d,True)[0]+script)]:
            payload={'title':title,'html':'<link rel="stylesheet" href="assets/lesson-pack.css?v=20261117-1">'+content}
            encrypt(json.dumps(payload,ensure_ascii=False).encode(),a.key_file,ROOT/'t'/(page+'.bin'),a.node)
        backup=copy.deepcopy(d);backup['source'].pop('path',None)
        encrypt(json.dumps(backup,ensure_ascii=False).encode(),a.key_file,ROOT/'t'/'sources'/(id+'.bin'),a.node)
        (a.input_dir/(ws+'-student.print.html')).write_text(print_sheet(d))
        (a.input_dir/(ws+'-teacher.print.html')).write_text(print_sheet(d,True))
        print('Built pupil pages and encrypted teacher pack:',id)

if __name__=='__main__':main()
