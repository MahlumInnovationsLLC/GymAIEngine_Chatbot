import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Equipment } from "@db/schema";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Grid, Wand2 } from "lucide-react";
import { FontAwesomeIcon } from "@/components/ui/font-awesome-icon"; // Added import
import { IconSuggestionDialog } from "./IconSuggestionDialog";

interface EquipmentIconProps {
  equipment: Equipment;
  isDragging?: boolean;
  onRequestSuggestion?: () => void;
  index: number;
  onDragStart: (e: React.DragEvent, index: number) => void;
  onDragEnter: (index: number) => void;
}

// Extended mapping of equipment types to Font Awesome icons
const equipmentIcons: Record<string, { icon: string; type: 'solid' | 'regular' | 'light' | 'thin' | 'duotone' | 'brands' }> = {
  "treadmill": { icon: "person-running", type: "solid" },
  "bike": { icon: "bicycle", type: "solid" },
  "elliptical": { icon: "person-walking", type: "solid" },
  "rowing": { icon: "person-swimming", type: "solid" },
  "weights": { icon: "weight-hanging", type: "solid" },
  "cardio": { icon: "heartbeat", type: "solid" },
  "strength": { icon: "dumbbell", type: "solid" },
  "yoga": { icon: "person-yoga", type: "solid" },
  "stairs": { icon: "stairs", type: "solid" },
  "screen": { icon: "display", type: "solid" },
  "gauge": { icon: "gauge-high", type: "solid" },
  "boxing": { icon: "hand-fist", type: "solid" },
  "metrics": { icon: "chart-line", type: "solid" },
  "stretching": { icon: "person-stretching", type: "solid" },
  "bench": { icon: "chair", type: "solid" },
  "balance": { icon: "scale-balanced", type: "solid" },
  "display": { icon: "tv", type: "solid" },
  "power": { icon: "bolt", type: "solid" }
};

const StatusIndicator = ({ status, className }: { status: string; className?: string }) => {
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'bg-green-500';
      case 'maintenance':
        return 'bg-yellow-500';
      case 'offline':
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <div className={cn(
      "absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-background",
      getStatusColor(status),
      className
    )} />
  );
};

const EquipmentIcon = ({ 
  equipment, 
  isDragging,
  onRequestSuggestion,
  index,
  onDragStart,
  onDragEnter,
}: EquipmentIconProps) => {
  const deviceType = equipment.deviceType?.toLowerCase() || 'strength';
  const iconConfig = equipmentIcons[deviceType] || equipmentIcons.strength;

  return (
    <motion.div
      layout
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragEnter={() => onDragEnter(index)}
      onDragOver={(e) => e.preventDefault()}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ 
        opacity: 1, 
        scale: isDragging ? 1.1 : 1,
        zIndex: isDragging ? 10 : 1,
      }}
      exit={{ opacity: 0, scale: 0.8 }}
      whileHover={{ scale: 1.05 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "bg-background rounded-lg border cursor-grab active:cursor-grabbing",
        "w-[120px] h-[120px] flex flex-col items-center justify-center p-3",
        "hover:bg-accent/50 transition-colors relative",
        isDragging ? "shadow-lg ring-2 ring-primary opacity-70" : "opacity-100"
      )}
    >
      <StatusIndicator status={equipment.status} />
      <div className="flex flex-col items-center gap-2">
        <div className="p-2 rounded-md bg-muted">
          <FontAwesomeIcon 
            icon={iconConfig.icon}
            type={iconConfig.type}
            size="lg"
          />
        </div>
        <span className="text-xs font-medium text-center line-clamp-2">
          {equipment.name}
        </span>
        <Badge variant="outline" className="text-xs">
          {equipment.deviceType || "Unknown"}
        </Badge>
      </div>
      {onRequestSuggestion && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onRequestSuggestion();
          }}
        >
          <Wand2 className="w-4 h-4" />
        </Button>
      )}
    </motion.div>
  );
};

interface EquipmentIconLibraryProps {
  equipment: Equipment[];
  onDragEnd?: (equipment: Equipment[]) => void;
}

export function EquipmentIconLibrary({ equipment, onDragEnd }: EquipmentIconLibraryProps) {
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [items, setItems] = useState(equipment);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  const handleRequestSuggestion = (equipment: Equipment) => {
    setSelectedEquipment(equipment);
    setShowSuggestions(true);
  };

  const handleSelectIcon = async (iconKey: string) => {
    if (!selectedEquipment) return;

    try {
      const response = await fetch(`/api/equipment/${selectedEquipment.id}/icon`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ iconKey }),
      });

      if (!response.ok) {
        throw new Error('Failed to update equipment icon');
      }
    } catch (error) {
      console.error('Failed to update equipment icon:', error);
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIdx(index);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  };

  const handleDragEnter = (index: number) => {
    if (draggedIdx === null) return;
    if (draggedIdx === index) return;

    const newItems = [...items];
    const draggedItem = newItems[draggedIdx];

    // Update positions while maintaining grid layout
    newItems.splice(draggedIdx, 1);
    newItems.splice(index, 0, draggedItem);

    setItems(newItems);
    setDraggedIdx(index);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    if (onDragEnd) {
      onDragEnd(items);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Grid className="w-5 h-5" />
          Equipment Icons
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] px-1">
          <div
            className="grid auto-rows-auto gap-6 p-4"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDragEnd}
          >
            <AnimatePresence>
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center justify-center"
                  style={{
                    gridRow: `auto`,
                    gridColumn: `auto`,
                  }}
                >
                  <EquipmentIcon
                    equipment={item}
                    isDragging={draggedIdx === index}
                    onRequestSuggestion={() => handleRequestSuggestion(item)}
                    index={index}
                    onDragStart={handleDragStart}
                    onDragEnter={handleDragEnter}
                  />
                </div>
              ))}
            </AnimatePresence>
          </div>
        </ScrollArea>
      </CardContent>

      {selectedEquipment && (
        <IconSuggestionDialog
          open={showSuggestions}
          onOpenChange={setShowSuggestions}
          equipmentName={selectedEquipment.name}
          equipmentType={selectedEquipment.deviceType || ''}
          onSelectIcon={handleSelectIcon}
        />
      )}
    </Card>
  );
}