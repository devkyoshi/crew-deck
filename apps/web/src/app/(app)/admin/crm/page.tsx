import { redirect } from 'next/navigation';

/** The CRM switch moved to Settings → Workspace and the pipeline editor to the CRM section. */
export default function Page() {
  redirect('/crm/pipelines');
}
