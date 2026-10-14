import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type CrmRecordType = 'company' | 'contact' | 'lead' | 'deal';

export interface CrmAccess {
  enabled: boolean;
  role: 'none' | 'viewer' | 'member' | 'admin';
  canView: boolean;
  canEdit: boolean;
  canAdmin: boolean;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

interface Owned {
  ownerId: string | null;
  ownerName: string | null;
  tags: Tag[];
  createdAt: string;
}

export interface Company extends Owned {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  size: string | null;
  contactCount: number;
  dealCount: number;
}

export interface Contact extends Owned {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  companyId: string | null;
  companyName: string | null;
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'unqualified';

export interface Lead extends Owned {
  id: string;
  name: string;
  email: string | null;
  companyName: string | null;
  source: string | null;
  status: LeadStatus;
  convertedAt: string | null;
  convertedCompanyId: string | null;
  convertedContactId: string | null;
  convertedDealId: string | null;
}

export type DealStatus = 'open' | 'won' | 'lost';

export interface Deal extends Owned {
  id: string;
  title: string;
  pipelineId: string;
  stageId: string;
  stageName: string;
  probability: number;
  status: DealStatus;
  value: number;
  currency: string;
  expectedClose: string | null;
  position: number;
  closedAt: string | null;
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
}

export interface DealDetail extends Deal {
  stages: { id: string; name: string; isWon: boolean; isLost: boolean }[];
}

export interface Stage {
  id: string;
  name: string;
  position: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
  dealCount: number;
}

export interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  stages: Stage[];
}

export interface BoardColumn extends Stage {
  count: number;
  totals: Record<string, number>;
  deals: Deal[];
}

export interface Board {
  pipeline: { id: string; name: string };
  pipelines: { id: string; name: string; isDefault: boolean }[];
  columns: BoardColumn[];
}

export type ActivityType = 'call' | 'meeting' | 'email' | 'task';

export interface Activity {
  id: string;
  type: ActivityType;
  subject: string;
  dueAt: string | null;
  completedAt: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  linkedType: CrmRecordType | null;
  linkedId: string | null;
  createdAt: string;
}

export interface Note {
  id: string;
  body: string;
  authorId: string;
  authorName: string | null;
  mentions: string[];
  linkedType: CrmRecordType;
  linkedId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrmDashboard {
  openDealsByStage: {
    stageId: string;
    stage: string;
    position: number;
    pipeline: string;
    currency: string;
    count: number;
    total: number;
  }[];
  wonThisMonth: { currency: string; count: number; total: number }[];
  leadsBySource: { source: string; count: number }[];
  leads: { open: number; converted: number };
  myOverdue: Activity[];
}

export interface ImportResult {
  total: number;
  validRows: number;
  errors: { row: number; field: string; message: string }[];
  errorCount: number;
  preview: Record<string, string | null>[];
  created: number;
  applied: boolean;
}

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  unqualified: 'Unqualified',
};

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  call: 'Call',
  meeting: 'Meeting',
  email: 'Email',
  task: 'Task',
};

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'SGD', 'AED'];

export function useCrmAccess() {
  return useQuery({
    queryKey: ['crm-access'],
    queryFn: () => api<CrmAccess>('/crm/access'),
    staleTime: 60_000,
  });
}

export function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
}

/** "$1,200 + €300" for a column that holds more than one currency. */
export function totalsText(totals: Record<string, number>) {
  const parts = Object.entries(totals)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, v]) => money(v, c));
  return parts.length ? parts.join(' + ') : money(0, 'USD');
}

export const recordHref = (type: CrmRecordType, id: string) =>
  `/crm/${type === 'company' ? 'companies' : `${type}s`}/${id}`;
