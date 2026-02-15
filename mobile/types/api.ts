export interface ApiError {
  response?: {
    status: number;
    data: {
      detail?: string;
      error?: string;
      [key: string]: unknown;
    };
  };
  message: string;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface DashboardStats {
  total_students: number;
  total_staff: number;
  attendance_percentage: number;
  fee_collection: number;
  pending_approvals: number;
}

export interface FinanceSummary {
  total_fee_collection: number;
  total_expenses: number;
  total_other_income: number;
  net_balance: number;
  month: number;
  year: number;
}
