import os
from dotenv import load_dotenv
import psycopg2

load_dotenv('D:/Personal/smart-attendance/backend/.env')
dsn = os.getenv('DATABASE_URL')
conn = psycopg2.connect(dsn)
cur = conn.cursor()

params = ('The Focus Montessori and School - Branch 1', '2026-27', 'Class 2', 'A')

cur.execute('''
WITH ctx AS (
  SELECT s.id AS school_id, ay.id AS year_id
  FROM schools_school s
  JOIN academic_sessions_academicyear ay ON ay.school_id = s.id
  WHERE s.name = %s AND ay.name = %s
  LIMIT 1
), target AS (
  SELECT sc.id AS session_class_id, sc.class_obj_id
  FROM academic_sessions_sessionclass sc
  JOIN ctx ON sc.school_id = ctx.school_id AND sc.academic_year_id = ctx.year_id
  WHERE sc.display_name = %s AND COALESCE(sc.section, '') = %s
  LIMIT 1
), candidates AS (
  SELECT e.id, e.student_id, e.roll_number
  FROM academic_sessions_studentenrollment e
  JOIN ctx ON e.school_id = ctx.school_id AND e.academic_year_id = ctx.year_id
  JOIN target t ON e.class_obj_id = t.class_obj_id
  WHERE e.is_active = TRUE AND e.session_class_id IS NULL
)
SELECT (SELECT school_id FROM ctx), (SELECT year_id FROM ctx), (SELECT session_class_id FROM target), COUNT(*)
FROM candidates;
''', params)
print('context:', cur.fetchone())

cur.execute('''
WITH ctx AS (
  SELECT s.id AS school_id, ay.id AS year_id
  FROM schools_school s
  JOIN academic_sessions_academicyear ay ON ay.school_id = s.id
  WHERE s.name = %s AND ay.name = %s
  LIMIT 1
), target AS (
  SELECT sc.id AS session_class_id, sc.class_obj_id
  FROM academic_sessions_sessionclass sc
  JOIN ctx ON sc.school_id = ctx.school_id AND sc.academic_year_id = ctx.year_id
  WHERE sc.display_name = %s AND COALESCE(sc.section, '') = %s
  LIMIT 1
), candidates AS (
  SELECT e.id, st.name, e.roll_number
  FROM academic_sessions_studentenrollment e
  JOIN students_student st ON st.id = e.student_id
  JOIN ctx ON e.school_id = ctx.school_id AND e.academic_year_id = ctx.year_id
  JOIN target t ON e.class_obj_id = t.class_obj_id
  WHERE e.is_active = TRUE AND e.session_class_id IS NULL
  ORDER BY
    CASE WHEN NULLIF(e.roll_number, '') ~ '^[0-9]+$' THEN NULLIF(e.roll_number, '')::int ELSE 999999 END,
    st.name
)
SELECT id, name, roll_number FROM candidates LIMIT 10;
''', params)
print('sample (first 10):')
for row in cur.fetchall():
    print(row)

cur.close()
conn.close()
