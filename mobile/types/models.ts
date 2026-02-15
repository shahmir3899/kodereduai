export interface School {
  id: number;
  name: string;
  role: string;
  is_default: boolean;
  enabled_modules: Record<string, boolean>;
}

export interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  role_display: string;
  school_id: number | null;
  school_name: string | null;
  is_super_admin: boolean;
  organization_id: number | null;
  organization_name: string | null;
  phone: string;
  profile_photo_url: string | null;
  schools: School[];
}

export interface LoginResponse {
  access: string;
  refresh: string;
  user: User;
}

export interface Student {
  id: number;
  name: string;
  roll_number: string;
  class_name: string;
  class_id: number;
  section: string;
  guardian_name: string;
  guardian_phone: string;
  profile_photo_url: string | null;
  is_active: boolean;
}

export interface FeePayment {
  id: number;
  student: number;
  student_name: string;
  class_name: string;
  month: number;
  year: number;
  amount: string;
  amount_paid: string;
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';
  due_date: string;
  paid_date: string | null;
}

export interface AttendanceRecord {
  id: number;
  student: number;
  student_name: string;
  date: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'LEAVE';
}

export interface TimetableEntry {
  id: number;
  day: string;
  slot_name: string;
  start_time: string;
  end_time: string;
  subject_name: string;
  teacher_name: string;
}

export interface ExamResult {
  id: number;
  exam_name: string;
  subject_name: string;
  marks_obtained: number;
  total_marks: number;
  grade: string;
}

export interface LeaveRequest {
  id: number;
  student_name: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  created_at: string;
}

export interface MessageThread {
  id: number;
  subject: string;
  other_user_name: string;
  last_message: string;
  last_message_at: string;
  unread_count: number;
}

export interface Notification {
  id: number;
  title: string;
  body: string;
  event_type: string;
  is_read: boolean;
  created_at: string;
}

export interface Expense {
  id: number;
  category: string;
  amount: string;
  description: string;
  date: string;
  created_at: string;
}

export interface OtherIncome {
  id: number;
  source: string;
  amount: string;
  description: string;
  date: string;
}

export interface NotificationTemplate {
  id: number;
  name: string;
  event_type: string;
  channel: string;
  subject_template: string;
  body_template: string;
  is_active: boolean;
}

export interface StaffMember {
  id: number;
  name: string;
  employee_id: string;
  department_name: string;
  designation_name: string;
  phone: string;
  email: string;
  profile_photo_url: string | null;
}

export interface GatePass {
  id: number;
  student_name: string;
  pass_type: string;
  reason: string;
  going_to: string;
  departure_date: string;
  expected_return: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'USED' | 'RETURNED' | 'EXPIRED';
}

export interface Assignment {
  id: number;
  title: string;
  description: string;
  subject_name: string;
  due_date: string;
  status: string;
  is_submitted: boolean;
}
