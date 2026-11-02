import {
  DEFAULT_TEMPLATE, REPORT_TEMPLATES, normalizeTemplate, reportCardFileName, reportCardPdfError, reportCardQueryParams,
} from '../services/reportCard';

describe('normalizeTemplate', () => {
  it('keeps the two known layouts and falls back to the default for anything else', () => {
    expect(normalizeTemplate('traditional')).toBe('traditional');
    expect(normalizeTemplate('enhanced')).toBe('enhanced');
    expect(normalizeTemplate('fancy')).toBe(DEFAULT_TEMPLATE);
    expect(normalizeTemplate(null)).toBe(DEFAULT_TEMPLATE);
  });

  it('offers exactly the layouts the server has', () => {
    expect(REPORT_TEMPLATES.map((t) => t.value)).toEqual(['enhanced', 'traditional']);
  });
});

describe('reportCardQueryParams', () => {
  it('is the query that loads the card the PDF is drawn from', () => {
    expect(reportCardQueryParams({ studentId: 7, enrollmentId: 12, yearId: 3, examIds: [4, 9] })).toEqual({
      student_id: 7, enrollment_id: 12, academic_year_id: 3, exam_ids: '4,9',
    });
  });

  it('leaves out an enrollment that is not chosen', () => {
    expect(reportCardQueryParams({ studentId: 7, enrollmentId: null, yearId: 3, examIds: [4] }).enrollment_id).toBeUndefined();
  });
});

describe('reportCardFileName', () => {
  it('is safe for a file system and names the layout', () => {
    expect(reportCardFileName('Ayesha Khan / 5-A', 'enhanced')).toBe('Report_Card_Ayesha_Khan_5_A_Enhanced.pdf');
    expect(reportCardFileName(undefined, 'traditional')).toBe('Report_Card_Student_Traditional.pdf');
    expect(reportCardFileName('!!!', 'enhanced')).toBe('Report_Card_Student_Enhanced.pdf');
  });
});

describe('reportCardPdfError', () => {
  const bytes = (obj: unknown) => new TextEncoder().encode(JSON.stringify(obj)).buffer;

  it('reads the server message out of the bytes', () => {
    expect(reportCardPdfError({ response: { status: 404, data: bytes({ detail: 'No enrollment found for the selected student/session.' }) } }))
      .toBe('No enrollment found for the selected student/session.');
  });

  it('explains a refusal, a dead connection and a server fault', () => {
    expect(reportCardPdfError({ response: { status: 403, data: new ArrayBuffer(0) } })).toMatch(/role cannot/);
    expect(reportCardPdfError({})).toMatch(/connection/);
    expect(reportCardPdfError({ response: { status: 500, data: new TextEncoder().encode('<html>').buffer } })).toMatch(/could not be created/);
  });
});
