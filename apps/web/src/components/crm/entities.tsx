import type { ReactNode } from 'react';
import Link from 'next/link';
import { CURRENCIES, LEAD_STATUS_LABEL, money, recordHref, type CrmRecordType } from '@/lib/crm';
import { formatDate } from '@/lib/format';
import { TagList } from './crm-bits';
import type { FieldDef } from './record-dialog';
import { LeadStatusPill } from './pills';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface EntityDef {
  type: CrmRecordType;
  /** URL / API segment, for example "companies". */
  plural: string;
  singular: string;
  title: string;
  /** Primary label of a record. */
  nameKey: string;
  fields: FieldDef[];
  /** Sensible defaults when creating. */
  blank: Record<string, unknown>;
  columns: { header: string; cell: (r: any) => ReactNode; className?: string }[];
  /** Read-only facts shown on the detail page beside the editable fields. */
  facts: { label: string; value: (r: any) => ReactNode }[];
  searchPlaceholder: string;
}

const nameLink = (type: CrmRecordType, key: string) =>
  function NameCell(r: any) {
    return (
      <Link href={recordHref(type, r.id)} className="font-medium hover:underline">
        {r[key]}
      </Link>
    );
  };

const dash = (v: ReactNode) =>
  v === null || v === undefined || v === '' ? <span className="text-muted-foreground">—</span> : v;
const owner = { header: 'Owner', cell: (r: any) => dash(r.ownerName) };
const tags = { header: 'Tags', cell: (r: any) => <TagList tags={r.tags} /> };
const added = { header: 'Added', cell: (r: any) => formatDate(r.createdAt) };

export const ENTITIES: Record<CrmRecordType, EntityDef> = {
  company: {
    type: 'company',
    plural: 'companies',
    singular: 'company',
    title: 'Companies',
    nameKey: 'name',
    searchPlaceholder: 'Search companies',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, max: 120 },
      { key: 'website', label: 'Website', type: 'text', max: 200, placeholder: 'https://' },
      { key: 'industry', label: 'Industry', type: 'text', max: 80 },
      { key: 'size', label: 'Size', type: 'text', max: 40, placeholder: 'For example 11-50' },
      { key: 'ownerId', label: 'Owner', type: 'owner' },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
    blank: { tags: [] },
    columns: [
      { header: 'Name', cell: nameLink('company', 'name') },
      { header: 'Industry', cell: (r) => dash(r.industry) },
      { header: 'Contacts', cell: (r) => r.contactCount, className: 'tabular-nums' },
      { header: 'Deals', cell: (r) => r.dealCount, className: 'tabular-nums' },
      owner,
      tags,
    ],
    facts: [
      { label: 'Website', value: (r) => dash(r.website) },
      { label: 'Industry', value: (r) => dash(r.industry) },
      { label: 'Size', value: (r) => dash(r.size) },
      { label: 'Owner', value: (r) => dash(r.ownerName) },
      { label: 'Tags', value: (r) => <TagList tags={r.tags} /> },
      { label: 'Added', value: (r) => formatDate(r.createdAt) },
    ],
  },
  contact: {
    type: 'contact',
    plural: 'contacts',
    singular: 'contact',
    title: 'Contacts',
    nameKey: 'name',
    searchPlaceholder: 'Search by name, email or job title',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, max: 120 },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'jobTitle', label: 'Job title', type: 'text', max: 80 },
      { key: 'companyId', label: 'Company', type: 'company', labelKey: 'companyName' },
      { key: 'ownerId', label: 'Owner', type: 'owner' },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
    blank: { tags: [] },
    columns: [
      { header: 'Name', cell: nameLink('contact', 'name') },
      { header: 'Email', cell: (r) => dash(r.email) },
      {
        header: 'Company',
        cell: (r) =>
          r.companyId ? (
            <Link className="hover:underline" href={recordHref('company', r.companyId)}>
              {r.companyName}
            </Link>
          ) : (
            dash(null)
          ),
      },
      owner,
      tags,
    ],
    facts: [
      { label: 'Email', value: (r) => dash(r.email) },
      { label: 'Phone', value: (r) => dash(r.phone) },
      { label: 'Job title', value: (r) => dash(r.jobTitle) },
      {
        label: 'Company',
        value: (r) =>
          r.companyId ? (
            <Link
              className="text-primary hover:underline"
              href={recordHref('company', r.companyId)}
            >
              {r.companyName}
            </Link>
          ) : (
            dash(null)
          ),
      },
      { label: 'Owner', value: (r) => dash(r.ownerName) },
      { label: 'Tags', value: (r) => <TagList tags={r.tags} /> },
    ],
  },
  lead: {
    type: 'lead',
    plural: 'leads',
    singular: 'lead',
    title: 'Leads',
    nameKey: 'name',
    searchPlaceholder: 'Search by name, email or company',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, max: 120 },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'companyName', label: 'Company name', type: 'text', max: 120 },
      {
        key: 'source',
        label: 'Source',
        type: 'text',
        max: 60,
        placeholder: 'Referral, website, event…',
      },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        options: Object.entries(LEAD_STATUS_LABEL).map(([value, label]) => ({ value, label })),
      },
      { key: 'ownerId', label: 'Owner', type: 'owner' },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
    blank: { status: 'new', tags: [] },
    columns: [
      { header: 'Name', cell: nameLink('lead', 'name') },
      { header: 'Company', cell: (r) => dash(r.companyName) },
      { header: 'Source', cell: (r) => dash(r.source) },
      { header: 'Status', cell: (r) => <LeadStatusPill lead={r} /> },
      owner,
      added,
    ],
    facts: [
      { label: 'Status', value: (r) => <LeadStatusPill lead={r} /> },
      { label: 'Email', value: (r) => dash(r.email) },
      { label: 'Company', value: (r) => dash(r.companyName) },
      { label: 'Source', value: (r) => dash(r.source) },
      { label: 'Owner', value: (r) => dash(r.ownerName) },
      { label: 'Tags', value: (r) => <TagList tags={r.tags} /> },
      { label: 'Added', value: (r) => formatDate(r.createdAt) },
    ],
  },
  deal: {
    type: 'deal',
    plural: 'deals',
    singular: 'deal',
    title: 'Deals',
    nameKey: 'title',
    searchPlaceholder: 'Search deals or companies',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true, max: 160 },
      { key: 'value', label: 'Value', type: 'number' },
      {
        key: 'currency',
        label: 'Currency',
        type: 'select',
        options: CURRENCIES.map((c) => ({ value: c, label: c })),
      },
      { key: 'expectedClose', label: 'Expected close', type: 'date' },
      { key: 'companyId', label: 'Company', type: 'company', labelKey: 'companyName' },
      { key: 'ownerId', label: 'Owner', type: 'owner' },
      { key: 'tags', label: 'Tags', type: 'tags' },
    ],
    blank: { currency: 'USD', value: 0, tags: [] },
    columns: [
      { header: 'Deal', cell: nameLink('deal', 'title') },
      { header: 'Company', cell: (r) => dash(r.companyName) },
      { header: 'Stage', cell: (r) => r.stageName },
      {
        header: 'Value',
        cell: (r) => money(r.value, r.currency),
        className: 'tabular-nums text-right',
      },
      {
        header: 'Close',
        cell: (r) => dash(r.expectedClose ? formatDate(r.expectedClose + 'T12:00:00') : null),
      },
      owner,
    ],
    facts: [
      { label: 'Value', value: (r) => money(r.value, r.currency) },
      { label: 'Stage', value: (r) => `${r.stageName} · ${r.probability}%` },
      {
        label: 'Company',
        value: (r) =>
          r.companyId ? (
            <Link
              className="text-primary hover:underline"
              href={recordHref('company', r.companyId)}
            >
              {r.companyName}
            </Link>
          ) : (
            dash(null)
          ),
      },
      {
        label: 'Contact',
        value: (r) =>
          r.contactId ? (
            <Link
              className="text-primary hover:underline"
              href={recordHref('contact', r.contactId)}
            >
              {r.contactName}
            </Link>
          ) : (
            dash(null)
          ),
      },
      {
        label: 'Expected close',
        value: (r) => dash(r.expectedClose ? formatDate(r.expectedClose + 'T12:00:00') : null),
      },
      { label: 'Owner', value: (r) => dash(r.ownerName) },
      { label: 'Tags', value: (r) => <TagList tags={r.tags} /> },
    ],
  },
};
