import { useEffect } from "react";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RiMicrosoftFill } from "react-icons/ri";
import { loginRequest } from "@/lib/msal-config";
import { useToast } from "@/hooks/use-toast";

export default function LoginPage() {
  const { instance } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (isAuthenticated) {
      setLocation("/dashboard");
    }
  }, [isAuthenticated, setLocation]);

  const handleLogin = async () => {
    try {
      // Clear any existing sessions first
      await instance.logoutRedirect().catch(() => {
        // Ignore any logout errors
      });

      // Then attempt login
      await instance.loginPopup(loginRequest);
      // If login is successful, the useEffect above will handle the redirect
    } catch (error) {
      console.error("Error during login:", error);
      toast({
        variant: "destructive",
        title: "Authentication Error",
        description: "Failed to sign in. Please try again.",
      });
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Welcome Back</CardTitle>
          <CardDescription>
            Sign in with your Microsoft account to continue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            size="lg"
            onClick={handleLogin}
          >
            <RiMicrosoftFill className="mr-2 h-5 w-5" />
            Sign in with Microsoft
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}