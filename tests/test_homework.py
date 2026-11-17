import importlib.util
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('homework_builder', ROOT / 'scripts/build_homework.py')


class HomeworkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.builder = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(cls.builder)
        cls.data = cls.builder.build(ROOT)

    def test_all_ege_lessons_contain_every_homework_task(self):
        for i in range(1, 21):
            with self.subTest(lesson=i):
                text = self.data[f'el{i}']
                expected = 6 if i <= 13 else 4 if i <= 19 else 3
                self.assertEqual(re.findall(r'^Д\d+\.', text, re.M), [f'Д{n}.' for n in range(1, expected + 1)])
                for task in re.split(r'\n\n(?=Д\d+\.)', text)[1:]:
                    self.assertGreater(len(task), 15, 'Task must include its condition')

    def test_full_conditions_not_just_numbers(self):
        self.assertIn('300 000 рублей', self.data['el13'])
        self.assertIn('110 000 рублей', self.data['el13'])
        self.assertIn('Д3. На доске числа', self.data['el20'])
        self.assertNotIn('Решение', self.data['el13'])

    def test_math_remains_unambiguous_in_plain_text(self):
        text = self.data['el2']
        self.assertIn('(2x + 1)/(x − 1)', text)
        self.assertIn('√(x + 10)', text)
        self.assertIn('2^(3 − x)', text)
        self.assertIn('(1)/(4)', text)

    def test_no_navigation_or_answers_in_assignments(self):
        for text in self.data.values():
            self.assertNotIn('Кабинет математики', text)
            self.assertNotIn('Все лекции', text)
            self.assertNotIn('правильный ответ:', text)

    def test_generated_file_matches_lessons(self):
        source = (ROOT / 'assets/homework-ege.js').read_text()
        self.assertEqual(json.loads(source.split(' = ', 1)[1].rstrip(';\n')), self.data)

    def test_missing_homework_fails_build(self):
        with self.assertRaises(ValueError):
            self.builder.extract('<main><h2>Теория</h2></main>')


if __name__ == '__main__':
    unittest.main()
