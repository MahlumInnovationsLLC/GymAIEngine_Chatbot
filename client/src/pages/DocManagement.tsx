import { useState, lazy, Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, FolderPlus, Upload, Download, Edit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";

// Lazy load components
const FileExplorer = lazy(() => import("@/components/document/FileExplorer"));
const DocumentViewer = lazy(() => import("@/components/document/DocumentViewer").then(mod => ({ default: mod.DocumentViewer })));

const LoadingSpinner = () => (
  <div className="flex items-center justify-center p-4">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

interface DocumentStatus {
  status: 'draft' | 'in_review' | 'approved' | 'rejected';
  reviewedBy?: string;
  approvedBy?: string;
  updatedAt: string;
}

export function DocManagement() {
  const [selectedDocumentPath, setSelectedDocumentPath] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const { data: documentStatus } = useQuery<DocumentStatus>({
    queryKey: ['/api/documents/workflow', selectedDocumentPath],
    enabled: !!selectedDocumentPath,
  });

  return (
    <div className="grid grid-cols-[30%_70%] gap-6">
      <Card className="h-[calc(100vh-24rem)] overflow-hidden">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center">
              <FileText className="h-5 w-5 mr-2" />
              DocExplore
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="icon">
                <FolderPlus className="h-4 w-4" />
              </Button>
              <Button size="icon">
                <Upload className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<LoadingSpinner />}>
            <FileExplorer onSelectDocument={setSelectedDocumentPath} />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center">
              <FileText className="h-5 w-5 mr-2" />
              Document Viewer
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setIsEditing(!isEditing)}
                disabled={!selectedDocumentPath}
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                disabled={!selectedDocumentPath}
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {selectedDocumentPath ? (
            <DocumentViewer documentId={selectedDocumentPath} isEditing={isEditing} />
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">
                Select a document from DocExplore to view or edit.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}