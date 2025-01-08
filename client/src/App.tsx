import { Switch, Route, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AnimatePresence } from "framer-motion";
import Navbar from "@/components/layout/Navbar";
import PageTransition from "@/components/layout/PageTransition";
import { OnboardingProvider } from "@/components/onboarding/OnboardingProvider";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { ModuleSelector } from "@/components/layout/ModuleSelector";
import Home from "@/pages/Home";
import ChatPage from "@/pages/ChatPage";
import { DocManagement } from "@/pages/DocManagement";
import DashboardPage from "@/pages/DashboardPage";
import ClubControlPage from "@/pages/ClubControlPage";

function App() {
  const [location] = useLocation();

  return (
    <QueryClientProvider client={queryClient}>
      <OnboardingProvider>
        <div className="min-h-screen bg-background">
          <Navbar />
          <main className="container mx-auto px-4 pt-16">
            <div className="flex gap-4">
              <ModuleSelector 
                activeModule={location.split('/')[1] || 'documents'} 
                onModuleChange={(moduleId) => {
                  window.location.href = `/${moduleId}`;
                }}
              />
              <div className="flex-1">
                <AnimatePresence mode="wait">
                  <Switch key={location}>
                    <Route path="/" component={Home} />
                    <Route path="/dashboard" component={DashboardPage} />
                    <Route path="/chat/:id?" component={ChatPage} />
                    <Route path="/documents" component={Home} />
                    <Route path="/docmanagement" component={DocManagement} />
                    <Route path="/training" component={Home} />
                    <Route path="/club-control" component={ClubControlPage} />
                    <Route component={NotFound} />
                  </Switch>
                </AnimatePresence>
              </div>
            </div>
          </main>
          <OnboardingTour />
          <Toaster />
        </div>
      </OnboardingProvider>
    </QueryClientProvider>
  );
}

// fallback 404 not found page
function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">404 Page Not Found</h1>
          </div>
          <p className="mt-4 text-sm text-gray-600">
            The page you're looking for doesn't exist.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default App;