from ultralytics import YOLO
import cv2
import numpy as np

class VisionEngine:
    def __init__(self, model_path="yolov8n.pt"):
        # Load a pretrained YOLOv8n model
        self.model = YOLO(model_path)
        # Class 19 is 'cow' in COCO dataset, but for general testing we might track all.
        # COCO: 19: cow, 20: elephant, 21: bear, 22: zebra, 23: giraffe...
        # Sheep is 18.
        self.target_classes = [19, 18] # Cow, Sheep
        
        # Simple tracking state (Dictionary of ID -> Centroid)
        # In a real deployed ByteTrack system, we'd use a dedicated library,
        # but for this MVP, we use YOLO's built-in tracker or simple logic.
        self.track_history = {}

    def set_classes(self, class_ids):
        """Update the target classes for YOLO filtering"""
        self.target_classes = class_ids
        print(f"Vision targets updated to: {self.target_classes}")

    def process_frame(self, frame):
        """
        Run inference on a frame and return results.
        :param frame: Standard OpenCV BGR frame.
        :return: (processed_frame, detections)
        """
        # Run inference
        # persist=True enables the built-in BoT-SORT/ByteTrack in YOLOv8
        results = self.model.track(frame, persist=True, classes=self.target_classes, verbose=False)
        
        detections = []
        
        if results and len(results) > 0:
            result = results[0]
            
            # Visualize the results on the frame (optional, if we want burned-in video)
            # annotated_frame = result.plot() 
            # For now, we return the original frame + metadata to keep it clean for the client
            # unless the user strictly requested processed video. 
            # User said: "emita el video procesado". So let's plot it.
            annotated_frame = result.plot()
            
            if result.boxes and result.boxes.id is not None:
                boxes = result.boxes.xyxy.cpu().numpy().astype(int)
                ids = result.boxes.id.cpu().numpy().astype(int)
                
                for box, track_id in zip(boxes, ids):
                    x1, y1, x2, y2 = box
                    centroid = (int((x1 + x2) // 2), int((y1 + y2) // 2))
                    detections.append({
                        "id": int(track_id),
                        "bbox": [int(x1), int(y1), int(x2), int(y2)],
                        "centroid": centroid
                    })
        else:
            annotated_frame = frame

        return annotated_frame, detections
