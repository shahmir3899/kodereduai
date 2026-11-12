import {
  AUDIENCES, CHANNELS, applyTemplate, audienceHasSections, broadcastResultText, buildBroadcastPayload, buildPreviewPayload,
  buildSinglePayload, composePlaceholders, emptyCompose, findPlaceholders, logRecipientType, previewLine, sendErrorMessage,
  validateCompose,
} from '../services/notificationSend';

const base = { ...emptyCompose(), title: ' Holiday ', body: ' School is closed. ' };

describe('choices', () => {
  it('offers only channels the server accepts', () => {
    expect(CHANNELS.map((c) => c.value)).toEqual(['IN_APP', 'PUSH', 'EMAIL']);
  });

  it('has the seven audiences the server knows', () => {
    expect(AUDIENCES.map((a) => a.value).sort()).toEqual(['MANAGER', 'PARENT', 'PRINCIPAL', 'SCHOOL_ADMIN', 'STAFF', 'STUDENT', 'TEACHER']);
  });

  it('narrows to a section only for parents and students', () => {
    expect(audienceHasSections('PARENT')).toBe(true);
    expect(audienceHasSections('STUDENT')).toBe(true);
    expect(audienceHasSections('TEACHER')).toBe(false);
  });
});

describe('validateCompose', () => {
  it('needs a title and a message', () => {
    expect(validateCompose(emptyCompose(), 'broadcast')).toContain('title');
    expect(validateCompose({ ...emptyCompose(), title: 'x' }, 'broadcast')).toContain('message');
    expect(validateCompose(base, 'broadcast')).toBeNull();
  });

  it('needs a person for a single send', () => {
    expect(validateCompose(base, 'single')).toContain('who');
    expect(validateCompose({ ...base, recipientId: 4 }, 'single')).toBeNull();
  });

  it('refuses a title over 200 characters', () => {
    expect(validateCompose({ ...base, title: 'x'.repeat(201) }, 'broadcast')).toContain('200');
  });
});

describe('broadcast and preview payloads', () => {
  it('sends the server field names and trims the text', () => {
    expect(buildBroadcastPayload(base)).toEqual({ event_type: 'GENERAL', channel: 'IN_APP', recipient_type: 'PARENT', title: 'Holiday', body: 'School is closed.' });
  });

  it('adds the section for parents and the master class when the year has no sections', () => {
    const section = { id: 9, classObj: 4, isSession: true };
    expect(buildBroadcastPayload({ ...base, placement: section })).toMatchObject({ session_class_id: 9 });
    expect(buildBroadcastPayload({ ...base, placement: { id: 4, classObj: null, isSession: false } })).toMatchObject({ class_obj_id: 4 });
    expect(buildPreviewPayload({ ...base, placement: section })).toEqual({ channel: 'IN_APP', recipient_type: 'PARENT', session_class_id: 9 });
  });

  it('ignores a section for roles that have none', () => {
    expect(buildBroadcastPayload({ ...base, audience: 'TEACHER', placement: { id: 9, classObj: 4, isSession: true } })).not.toHaveProperty('session_class_id');
  });
});

describe('single send', () => {
  it('sends the person as an identifier with the log recipient type', () => {
    const p = buildSinglePayload({ ...base, recipientId: 12, recipientRole: 'SCHOOL_ADMIN' });
    expect(p).toEqual({ event_type: 'GENERAL', channel: 'IN_APP', recipient_identifier: '12', recipient_type: 'ADMIN', title: 'Holiday', body: 'School is closed.' });
  });

  it.each([['PARENT', 'PARENT'], ['PRINCIPAL', 'ADMIN'], ['TEACHER', 'STAFF'], ['STUDENT', 'STAFF']])('%s logs as %s', (role, type) => {
    expect(logRecipientType(role)).toBe(type);
  });
});

describe('placeholders', () => {
  it('finds each placeholder once', () => {
    expect(findPlaceholders('Dear {{ parent_name }}, {{student_name}} and {{student_name}}')).toEqual(['parent_name', 'student_name']);
    expect(findPlaceholders('plain text')).toEqual([]);
  });

  it('looks in both title and body', () => {
    expect(composePlaceholders({ title: 'Hi {{a}}', body: 'See {{b}}' })).toEqual(['a', 'b']);
  });
});

describe('applyTemplate', () => {
  const t = { id: 1, name: 'Fee', event_type: 'FEE_DUE', channel: 'WHATSAPP', subject_template: 'Fee due', body_template: 'Pay by {{date}}' };

  it('fills the text and type but keeps a channel the server will not send on out', () => {
    const f = applyTemplate(base, t);
    expect(f).toMatchObject({ eventType: 'FEE_DUE', channel: 'IN_APP', title: 'Fee due', body: 'Pay by {{date}}' });
  });

  it('takes a supported channel from the template', () => {
    expect(applyTemplate(base, { ...t, channel: 'EMAIL' }).channel).toBe('EMAIL');
  });
});

describe('result text', () => {
  it('summarises a broadcast', () => {
    expect(broadcastResultText({ sent: 3, total_recipients: 5, skipped: 1, failed: 1 })).toBe('Sent to 3 of 5, 1 skipped (opted out or channel off), 1 failed.');
    expect(broadcastResultText({ sent: 2, total_recipients: 2 })).toBe('Sent to 2 of 2.');
  });

  it('describes the preview', () => {
    expect(previewLine({ count: 0, samples: [] })).toBe('No one would receive this.');
    expect(previewLine({ count: 1, samples: [{ id: 1, name: 'Ali' }] })).toBe('1 person: Ali');
    expect(previewLine({ count: 5, samples: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }] })).toBe('5 people: A, B, C and 2 more');
  });
});

describe('sendErrorMessage', () => {
  it('shows the server detail or first field message, else the fallback', () => {
    expect(sendErrorMessage({ response: { data: { detail: 'No users found with role PARENT in this school.' } } }, 'x')).toBe('No users found with role PARENT in this school.');
    expect(sendErrorMessage({ response: { data: { title: ['This field is required.'] } } }, 'x')).toBe('This field is required.');
    expect(sendErrorMessage(new Error('boom'), 'Could not send.')).toBe('Could not send.');
  });
});
