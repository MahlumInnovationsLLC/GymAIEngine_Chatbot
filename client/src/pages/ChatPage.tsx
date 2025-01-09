import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import ChatInterface from "@/components/chat/ChatInterface";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Plus } from "lucide-react";
import { useState } from "react";

export default function ChatPage() {
  const [match, params] = useRoute("/chat/:id?");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const handleNewChat = () => {
    if (params?.id) {
      setShowConfirmDialog(true);
    } else {
      window.location.href = '/chat';
    }
  };

  const confirmNewChat = () => {
    setShowConfirmDialog(false);
    window.location.href = '/chat';
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Main chat area with New Chat button */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b bg-background">
          <Button
            onClick={handleNewChat}
            variant="outline"
            className="w-full sm:w-auto"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Chat
          </Button>
        </div>

        <div className="flex-1">
          <ChatInterface chatId={params?.id} />
        </div>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start New Chat?</AlertDialogTitle>
            <AlertDialogDescription>
              Starting a new chat will end your current conversation. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmNewChat}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}