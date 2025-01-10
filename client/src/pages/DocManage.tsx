import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, FolderPlus, Upload, Download, Edit, History } from "lucide-react";
import { FileExplorer } from "@/components/document/FileExplorer";
import { DocumentConfig } from "@/components/document/DocumentConfig";
import { Button } from "@/components/ui/button";
import { DocumentViewer } from "@/components/document/DocumentViewer";
import { Separator } from "@/components/ui/separator";

export function DocManage() {
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const handleDownload = async () => {
    if (!selectedDocumentId) return;
    // TODO: Implement download functionality
  };

  const handleRevise = () => {
    if (!selectedDocumentId) return;
    // TODO: Implement revision functionality
  };

  return (
    <div className="container mx-auto">
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-4 py-2">
          <h1 className="text-2xl font-bold">Document Training & Control</h1>
          <p className="text-muted-foreground">
            Browse and manage documents with advanced training and workflow control.
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-[300px,1fr] gap-6">
        <Card className="h-[calc(100vh-12rem)] overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center">
                <FileText className="h-5 w-5 mr-2" />
                DocExplorer
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
          <CardContent className="-mx-2">
            <FileExplorer onSelectDocument={(id) => setSelectedDocumentId(id)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <FileText className="h-5 w-5 mr-2" />
              DocManage
            </CardTitle>
            <div className="flex gap-2 mt-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setIsEditing(!isEditing)}
                disabled={!selectedDocumentId}
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleDownload}
                disabled={!selectedDocumentId}
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleRevise}
                disabled={!selectedDocumentId}
              >
                <History className="h-4 w-4 mr-2" />
                Revise
              </Button>
            </div>
            <Separator className="mt-2" />
          </CardHeader>
          <CardContent>
            {selectedDocumentId ? (
              <div className="space-y-4">
                <DocumentViewer 
                  documentId={selectedDocumentId} 
                  isEditing={isEditing}
                />
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-muted-foreground">
                  Select a document from the explorer to view and manage its details.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}