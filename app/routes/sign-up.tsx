import { useState } from 'react';
import { useSignUp } from '@clerk/react-router';
import { getAuth } from '@clerk/react-router/server';
import { Link, redirect } from 'react-router';

import type { Route } from './+types/sign-up';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';
import { cn } from '~/lib/utils';

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Sign up - Finanz' },
    { name: 'description', content: 'Create your Finanz account' },
  ];
}

export async function loader(args: Route.LoaderArgs) {
  const auth = await getAuth(args);
  if (auth.isAuthenticated) {
    throw redirect('/');
  }
  return null;
}

type Step = 'email' | 'code';
type PendingAction = 'send' | 'verify' | 'resend' | 'reset';

function formatClerkError(
  error: { message?: string; longMessage?: string } | null | undefined,
): string | null {
  if (!error) return null;
  return error.longMessage ?? error.message ?? 'Something went wrong.';
}

function SignUpForm() {
  const { signUp, errors, fetchStatus } = useSignUp();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const isPending = fetchStatus === 'fetching' || pendingAction !== null;
  const fieldError =
    step === 'email' ? errors.fields.emailAddress : errors.fields.code;
  const globalError = errors.global?.[0];
  const inlineError =
    formError ??
    formatClerkError(fieldError) ??
    formatClerkError(globalError);

  async function handleEmailSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFormError('Enter your email address.');
      return;
    }

    setPendingAction('send');
    try {
      const createResult = await signUp.create({ emailAddress: trimmedEmail });
      if (createResult.error) {
        setFormError(formatClerkError(createResult.error));
        return;
      }

      const sendResult = await signUp.verifications.sendEmailCode();
      if (sendResult.error) {
        setFormError(formatClerkError(sendResult.error));
        return;
      }

      setEmail(trimmedEmail);
      setStep('code');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCodeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const trimmedCode = code.trim();
    if (trimmedCode.length !== 6) {
      setFormError('Enter the 6-digit code from your email.');
      return;
    }

    setPendingAction('verify');
    try {
      const verifyResult = await signUp.verifications.verifyEmailCode({
        code: trimmedCode,
      });
      if (verifyResult.error) {
        setFormError(formatClerkError(verifyResult.error));
        return;
      }

      if (signUp.status !== 'complete') {
        setFormError('This sign-up requires an unsupported verification step.');
        return;
      }

      const finalizeResult = await signUp.finalize({
        navigate: ({ decorateUrl }) => {
          window.location.assign(decorateUrl('/'));
        },
      });

      if (finalizeResult.error) {
        setFormError(formatClerkError(finalizeResult.error));
      }
    } finally {
      setPendingAction(null);
    }
  }

  async function handleResendCode() {
    setFormError(null);
    setPendingAction('resend');
    try {
      const sendResult = await signUp.verifications.sendEmailCode();
      if (sendResult.error) {
        setFormError(formatClerkError(sendResult.error));
      }
    } finally {
      setPendingAction(null);
    }
  }

  async function handleUseDifferentEmail() {
    setFormError(null);
    setPendingAction('reset');
    try {
      const resetResult = await signUp.reset();
      if (resetResult.error) {
        setFormError(formatClerkError(resetResult.error));
        return;
      }

      setCode('');
      setStep('email');
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <Card className='w-full max-w-md'>
      <CardHeader>
        <CardTitle>Create your Finanz account</CardTitle>
        <CardDescription>
          {step === 'email'
            ? 'Enter your email to receive a one-time verification code.'
            : `We sent a 6-digit code to ${email}.`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div
          key={step}
          className='animate-in fade-in slide-in-from-bottom-2 duration-200 ease-out'
        >
          {step === 'email' ? (
            <form className='space-y-4' onSubmit={handleEmailSubmit}>
              <div className='space-y-2'>
                <label
                  htmlFor='email'
                  className='text-sm font-medium text-foreground'
                >
                  Email
                </label>
                <input
                  id='email'
                  name='email'
                  type='email'
                  autoComplete='email'
                  inputMode='email'
                  required
                  value={email}
                  disabled={isPending}
                  onChange={(event) => setEmail(event.target.value)}
                  className={cn(
                    'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-[color,box-shadow] duration-200 ease-out',
                    'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                  placeholder='you@example.com'
                />
              </div>

              {inlineError ? (
                <p role='alert' className='text-sm text-destructive'>
                  {inlineError}
                </p>
              ) : null}

              <Button
                type='submit'
                disabled={isPending}
                className='w-full'
              >
                {pendingAction === 'send' ? 'Sending code...' : 'Continue'}
              </Button>
            </form>
          ) : (
            <form className='space-y-4' onSubmit={handleCodeSubmit}>
              <div className='space-y-2'>
                <label
                  htmlFor='code'
                  className='text-sm font-medium text-foreground'
                >
                  Verification code
                </label>
                <input
                  id='code'
                  name='code'
                  type='text'
                  inputMode='numeric'
                  autoComplete='one-time-code'
                  pattern='[0-9]{6}'
                  maxLength={6}
                  required
                  value={code}
                  disabled={isPending}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  className={cn(
                    'w-full rounded-lg border border-input bg-background px-3 py-2 text-center text-lg tracking-[0.3em] text-foreground outline-none transition-[color,box-shadow] duration-200 ease-out',
                    'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                  placeholder='000000'
                />
              </div>

              {inlineError ? (
                <p role='alert' className='text-sm text-destructive'>
                  {inlineError}
                </p>
              ) : null}

              <Button
                type='submit'
                disabled={isPending || code.length !== 6}
                className='w-full'
              >
                {pendingAction === 'verify' ? 'Verifying...' : 'Create account'}
              </Button>

              <div className='flex flex-wrap items-center justify-between gap-2'>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={isPending}
                  onClick={() => void handleResendCode()}
                  className='transition-colors duration-200 ease-out'
                >
                  {pendingAction === 'resend' ? 'Resending...' : 'Resend code'}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={isPending}
                  onClick={() => void handleUseDifferentEmail()}
                  className='transition-colors duration-200 ease-out'
                >
                  {pendingAction === 'reset'
                    ? 'Resetting...'
                    : 'Use a different email'}
                </Button>
              </div>
            </form>
          )}
        </div>

        <p className='mt-4 text-center text-sm text-muted-foreground'>
          Already have an account?{' '}
          <Link className='text-primary hover:underline' to='/sign-in'>
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function SignUp() {
  return (
    <main className='mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-10'>
      <SignUpForm />
    </main>
  );
}
