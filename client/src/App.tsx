import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { FontAwesomeIcon } from "@/components/ui/font-awesome-icon";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { AnimatePresenceWrapper, AnimateTransition } from "@/components/ui/AnimateTransition";
import { OnboardingProvider } from "@/components/onboarding/OnboardingProvider";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { NotificationCenter } from "@/components/ui/NotificationCenter";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ParticleBackground } from "@/components/ui/ParticleBackground";
import Navbar from "@/components/layout/Navbar";
import { MsalProvider, AuthenticatedTemplate, UnauthenticatedTemplate } from "@azure/msal-react";
import { PublicClientApplication } from "@azure/msal-browser";
import { msalConfig } from "@/lib/msal-config";

// Initialize MSAL instance
const msalInstance = new PublicClientApplication(msalConfig);

// Lazy load route components with error boundaries
const Home = lazy(() => import("@/pages/Home"));
const ChatPage = lazy(() => import("@/pages/ChatPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const ClubControlPage = lazy(() => import("@/pages/ClubControlPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const DocManagePage = lazy(() => import("@/pages/DocManage"));
const DocumentManagementPage = lazy(() => import("@/pages/DocumentManagement"));
const TrainingModulePage = lazy(() => import("@/pages/TrainingModule"));
const AdminDashboard = lazy(() => import("@/pages/admin/Dashboard"));
const TicketDetails = lazy(() => import("@/pages/admin/TicketDetails"));
const SupportTickets = lazy(() => import("@/pages/admin/SupportTickets"));
const TicketDetailsPage = lazy(() => import("@/pages/TicketDetailsPage"));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  );
}

function RedirectToLogin() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/login");
  }, [setLocation]);

  return <LoadingFallback />;
}

function RedirectToDashboard() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/dashboard");
  }, [setLocation]);

  return <LoadingFallback />;
}

function ProtectedRoute({ component: Component, ...rest }: { component: React.ComponentType<any> }) {
  return (
    <ErrorBoundary fallback={<div>Something went wrong</div>}>
      <Suspense fallback={<LoadingFallback />}>
        <AuthenticatedTemplate>
          <OnboardingProvider>
            <AnimateTransition variant="fade">
              <Component {...rest} />
            </AnimateTransition>
            <OnboardingTour />
          </OnboardingProvider>
        </AuthenticatedTemplate>
        <UnauthenticatedTemplate>
          <RedirectToLogin />
        </UnauthenticatedTemplate>
      </Suspense>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <div className="fixed inset-0 w-screen h-screen flex flex-col overflow-auto">
      <div className="fixed inset-0 -z-20 w-full h-full">
        <ParticleBackground className="absolute inset-0 w-full h-full" particleColor="rgba(239, 68, 68, 0.2)" />
        <div className="absolute inset-0 w-full h-full bg-background/90" />
      </div>

      <ErrorBoundary fallback={<div>Something went wrong</div>}>
        <AuthenticatedTemplate>
          <div className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Navbar />
          </div>
        </AuthenticatedTemplate>

        <main className="flex-1 pt-6 relative z-10">
          <div className="container mx-auto">
            <AnimatePresenceWrapper>
              <Suspense fallback={<LoadingFallback />}>
                <Switch>
                  <Route path="/login">
                    <UnauthenticatedTemplate>
                      <LoginPage />
                    </UnauthenticatedTemplate>
                    <AuthenticatedTemplate>
                      <RedirectToDashboard />
                    </AuthenticatedTemplate>
                  </Route>
                  <Route path="/" component={() => <ProtectedRoute component={Home} />} />
                  <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />
                  <Route path="/chat/:id?" component={() => <ProtectedRoute component={ChatPage} />} />
                  <Route path="/docmanage" component={() => <ProtectedRoute component={DocManagePage} />} />
                  <Route path="/docmanage/docmanagement" component={() => <ProtectedRoute component={DocumentManagementPage} />} />
                  <Route path="/docmanage/training" component={() => <ProtectedRoute component={TrainingModulePage} />} />
                  <Route path="/club-control" component={() => <ProtectedRoute component={ClubControlPage} />} />
                  <Route path="/admin/support" component={() => <ProtectedRoute component={SupportTickets} />} />
                  <Route path="/admin/support/:id" component={() => (
                    <ProtectedRoute component={TicketDetailsPage} />
                  )} />
                  <Route component={NotFound} />
                </Switch>
              </Suspense>
            </AnimatePresenceWrapper>
          </div>
        </main>
        <Toaster />
      </ErrorBoundary>
    </div>
  );
}

function NotFound() {
  return (
    <AnimateTransition variant="slide-up">
      <Card className="w-full max-w-md mx-4 mt-8">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <FontAwesomeIcon icon="circle-exclamation" className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">404 Page Not Found</h1>
          </div>
          <p className="mt-4 text-sm text-gray-600">
            The page you're looking for doesn't exist.
          </p>
        </CardContent>
      </Card>
    </AnimateTransition>
  );
}

export default function AppWrapper() {
  return (
    <ErrorBoundary fallback={<div>Something went wrong</div>}>
      <MsalProvider instance={msalInstance}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <App />
          </ThemeProvider>
        </QueryClientProvider>
      </MsalProvider>
    </ErrorBoundary>
  );
}