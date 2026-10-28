'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { Eye, EyeOff, Lock, Mail, ShieldCheck, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { fadeUp, staggerContainer, staggerItem, tapScale } from '@/lib/motion';

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const rawCallbackUrl = params.get('callbackUrl') || '/dashboard';
  const callbackUrl =
    rawCallbackUrl.startsWith('/') && !rawCallbackUrl.startsWith('//') && !rawCallbackUrl.startsWith('/\\')
      ? rawCallbackUrl
      : '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setError('Invalid email or password. Please try again.');
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="dashboard-shell min-h-dvh flex items-center justify-center bg-background p-4">
      <motion.div
        {...fadeUp}
        className="w-full max-w-sm"
      >
        {/* Logo mark */}
        <motion.div
          initial={{ opacity: 0, scale: 0.75, y: -10 }}
          animate={{ opacity: 1, scale: 1,    y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22, delay: 0.05 }}
          className="mb-8 flex flex-col items-center gap-3 text-center"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-bold text-xl shadow-lg shadow-primary/25">
            OV
          </div>
          <div>
            <h1 className="font-semibold text-foreground text-base tracking-wide">Admin Portal</h1>
            <p className="text-xs text-muted-foreground mt-0.5">ONE VOIZE FRIENDS CLUB OF LAGOS</p>
          </div>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
        >
          <Card size="sm">
            <CardHeader>
              <motion.div variants={staggerItem} className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-primary" />
                <CardTitle className="text-sm normal-case tracking-normal font-semibold">Secure sign in</CardTitle>
              </motion.div>
              <CardDescription>
                Enter your credentials to access the dashboard.
              </CardDescription>
            </CardHeader>

            <CardContent>
              {/* Error banner */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, y: -6 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                    className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-sm text-destructive dark:bg-destructive/15"
                  >
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleSubmit} className="space-y-4">
                <motion.div variants={staggerItem} className="space-y-1.5">
                  <Label htmlFor="email">Email address</Label>
                  <div className="relative">
                    <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      placeholder="admin@onevoize.org"
                      className="pl-9"
                    />
                  </div>
                </motion.div>

                <motion.div variants={staggerItem} className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                      id="password"
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="pl-9 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(p => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                    >
                      {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </motion.div>

                <motion.div variants={staggerItem} whileTap={tapScale}>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full"
                    size="default"
                  >
                    {loading ? (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex items-center gap-2"
                      >
                        <motion.span
                          animate={{ rotate: 360 }}
                          transition={{ repeat: Infinity, duration: 0.7, ease: 'linear' }}
                          className="block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
                        />
                        Signing in…
                      </motion.span>
                    ) : 'Sign in'}
                  </Button>
                </motion.div>
              </form>
            </CardContent>
          </Card>

          <motion.p
            variants={staggerItem}
            className="mt-5 text-center text-xs text-muted-foreground"
          >
            Contact your superadmin if you need access.
          </motion.p>
        </motion.div>
      </motion.div>
    </div>
  );
}
