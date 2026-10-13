import { SignInForm } from './sign-in-form';

export const metadata = { title: 'Sign in · Crew Deck' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <SignInForm initialError={error} />;
}
