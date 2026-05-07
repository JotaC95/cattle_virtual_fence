from ultralytics import YOLO
import cv2
import numpy as np
import torch

class VisionEngine:
    CLASS_NAMES = {0: "person", 18: "sheep", 19: "cow"}

    def __init__(self, model_path="yolov8m.pt"):
        device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = YOLO(model_path)
        self.model.to(device)
        # 0: person, 18: sheep, 19: cow (COCO)
        self.target_classes = [0, 18, 19]
        self.track_history = {}

    def process_frame(self, frame):
        """
        Run inference on a frame and return results.
        :param frame: Standard OpenCV BGR frame.
        :return: (processed_frame, detections)
          Each detection: {id, bbox, centroid, class_type}
        """
        results = self.model.track(
            frame,
            persist=True,
            classes=self.target_classes,
            conf=0.4,
            verbose=False,
        )

        detections = []

        if results and len(results) > 0:
            result = results[0]
            annotated_frame = result.plot()

            if result.boxes and result.boxes.id is not None:
                boxes = result.boxes.xyxy.cpu().numpy().astype(int)
                ids = result.boxes.id.cpu().numpy().astype(int)
                classes = result.boxes.cls.cpu().numpy().astype(int)

                for box, track_id, cls_id in zip(boxes, ids, classes):
                    x1, y1, x2, y2 = box
                    centroid = (int((x1 + x2) // 2), int((y1 + y2) // 2))
                    detections.append({
                        "id": int(track_id),
                        "bbox": [int(x1), int(y1), int(x2), int(y2)],
                        "centroid": centroid,
                        "class_type": self.CLASS_NAMES.get(int(cls_id), "unknown"),
                    })
        else:
            annotated_frame = frame

        return annotated_frame, detections
