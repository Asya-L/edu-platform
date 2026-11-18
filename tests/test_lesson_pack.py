import re
import struct
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
PACKS={'a18':('sa18','wsa18','algebra.html'),'ma26':('sma26','wsma26','algebra-m.html'),'g21':('s21','ws21','geometry.html'),'mg24':('smg24','wsmg24','geometry-m.html')}

class LessonPackTests(unittest.TestCase):
    def test_complete_student_packs_and_private_teacher_materials(self):
        for lesson,(slides,ws,index) in PACKS.items():
            with self.subTest(lesson=lesson):
                lecture=(ROOT/(lesson+'.html')).read_text()
                self.assertIn('data-lesson-pack="'+lesson+'"',(ROOT/index).read_text())
                self.assertIn('id="theory"',lecture)
                self.assertEqual(len(re.findall(r'<article class="practice-task">',lecture)),6)
                self.assertEqual(len(re.findall(r'<span class="task-no">Д\d+\.</span>',lecture)),6)
                for file in [lesson,slides,ws,'quiz-'+lesson+'a','quiz-'+lesson+'b']:
                    text=(ROOT/(file+'.html')).read_text()
                    self.assertNotIn('TEACHER-ONLY-',text)
                    self.assertNotIn('teacherNotesHtml',text)
                    self.assertNotIn('explanationHtml',text)
                for file in [lesson,ws,'sources/'+lesson,'files/'+ws+'-teacher.pdf']:
                    data=(ROOT/'t'/(file+'.bin')).read_bytes()
                    self.assertGreater(len(data),100)
                    self.assertNotIn(b'TEACHER-ONLY-',data)
                self.assertTrue((ROOT/'files'/(ws+'-student.pdf')).read_bytes().startswith(b'%PDF-'))

    def test_quizzes_have_six_questions_and_no_embedded_keys(self):
        for lesson in PACKS:
            for suffix in 'ab':
                with self.subTest(lesson=lesson,suffix=suffix):
                    text=(ROOT/('quiz-'+lesson+suffix+'.html')).read_text()
                    self.assertEqual(re.findall(r'class="qz-q" data-q="(\d+)"',text),list(map(str,range(1,7))))
                    self.assertIn('var QID = "quiz-'+lesson+suffix+'"',text)
                    self.assertNotRegex(text,r'data-key|"answer"\s*:|"key"\s*:')
                    self.assertNotIn('Урок 25</a>',text)

    def test_slides_are_complete_and_match_board_images(self):
        for lesson,(slides,_,_) in PACKS.items():
            with self.subTest(lesson=lesson):
                self.assertEqual((ROOT/(slides+'.html')).read_text().count('<section class="slide">'),10)
                for i in range(1,11):
                    data=(ROOT/'assets/slides'/lesson/(str(i).zfill(2)+'.png')).read_bytes()
                    self.assertEqual(data[:8],b'\x89PNG\r\n\x1a\n')
                    self.assertEqual(struct.unpack('>II',data[16:24]),(1280,720))

    def test_geometry_notation_and_source_labels(self):
        self.assertNotIn('⃗',(ROOT/'g21.html').read_text())
        self.assertNotIn('⃗',(ROOT/'s21.html').read_text())
        for file in ['mg24','smg24','wsmg24','quiz-mg24a','quiz-mg24b']:
            self.assertNotRegex((ROOT/(file+'.html')).read_text(),r'§\s*24\b')
        self.assertIn('Платоновы тела',(ROOT/'mg24.html').read_text())

if __name__=='__main__':unittest.main()
