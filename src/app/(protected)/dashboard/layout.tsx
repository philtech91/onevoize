import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';

export const metadata: Metadata = {
  title: 'Dashboard | ONE VOIZE',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/dashboard/login');
  }

  return (
    <div className="dashboard-shell flex h-dvh overflow-hidden bg-background">
      <DashboardSidebar role={session.user.role} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <DashboardHeader user={session.user} />

        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
