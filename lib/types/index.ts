// Beneficiary Types
export interface IBeneficiary {
  id: string
  tc?: string
  firstName?: string
  lastName?: string
  name?: string
  phone?: string
  address?: string
  district?: string
  neighborhood?: string
  birthDate?: Date
  status?: number
  notes?: string
  createdAt?: Date
  updatedAt?: Date
  dosyaId?: string
  request?: IRequest
}

// Document Types
export interface IDocument {
  id: string
  requestId?: string
  title: string
  status?: string
  notes?: string
  tc?: string
  name?: string
  requestedDate?: Date
  completedDate?: Date
  createdAt?: Date
  updatedAt?: Date
  request?: IRequest
}

// Request Types
export interface IRequest {
  id: string
  title?: string
  description?: string
  status?: number
  priority?: number
  mahalleadi?: string
  cadde?: string
  sokak?: string
  site?: string
  blok?: string
  binano?: string
  daireno?: string
  beneficiaries?: IBeneficiary[]
  documents?: IDocument[]
  assistances?: IAssistance[]
  workflowSteps?: IWorkflowStep[]
  reports?: IReport[]
  createdAt?: Date
  updatedAt?: Date
}

// Assistance Types
export interface IAssistance {
  id: string
  requestId?: string
  applicant?: string
  amount?: number
  status?: number
  notes?: string
  tc?: string
  phone?: string
  type?: string
  createdAt?: Date
  updatedAt?: Date
  request?: IRequest
}

// User Types
export interface IUser {
  id: string
  username?: string
  name?: string
  department?: string
  status?: number
  email?: string
  phone?: string | null
  address?: string | null
  // Bir sonraki girişte şifresini değiştirmesi gerekip gerekmediği - bkz.
  // user.service.ts / app/api/auth/login/route.ts.
  mustChangePassword?: boolean
}

// Workflow Types
export interface IWorkflowStep {
  id: string
  title: string
  description?: string
  status?: string
  priority?: string
  requestId?: string
  assignedStaff?: string
  dueDate?: Date
  completedDate?: Date
  createdAt?: Date
  updatedAt?: Date
}

// Report Types
export interface IReport {
  id: string
  title?: string
  content?: string
  date?: Date
  requestId?: string
  createdAt?: Date
  updatedAt?: Date
  request?: IRequest
  kullaniciid?: number | null
  ilkkullaniciid?: number | null
  userName?: string | null
  // "Onaya Gönder" akisindan otomatik olusturulan raporlarda, onaylandiktan
  // sonra dolan alanlar (bkz. report.service.ts - getByRequest).
  onaylayan_kullaniciid?: number | null
  approverName?: string | null
}

// Settings Types
export interface ISetting {
  key: string
  value: any
  type: string
  updatedAt?: Date
}

// API Response Types
export interface IApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface IApiPaginatedResponse<T> {
  success: boolean
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}
