from ultralytics import YOLO
import cv2
import numpy as np
import logging
from typing import List, Dict, Tuple

logger = logging.getLogger(__name__)


class SimpleByteTracker:
    """
    Implementación simplificada de ByteTrack para mantener tracking de objetos.
    Mantiene continuidad de IDs incluso cuando la detección falla temporalmente.
    """

    def __init__(self, track_buffer=30, track_thresh=0.5, match_thresh=0.8):
        self.track_buffer = track_buffer  # Frames para mantener track sin detección
        self.track_thresh = track_thresh  # Threshold de confianza mínimo
        self.match_thresh = match_thresh  # Threshold para matching de IoU
        self.tracks = {}  # Dict de track_id -> track_info
        self.next_id = 1
        self.frame_count = 0

    def update(self, detections: List[Dict], frame_shape: Tuple[int, int]) -> List[Dict]:
        """
        Actualizar tracking con nuevas detecciones.

        Args:
            detections: Lista de {bbox: [x1,y1,x2,y2], confidence, class, class_id}
            frame_shape: (h, w) de la imagen

        Returns:
            Lista de detecciones trackeadas con 'id' persistente
        """
        self.frame_count += 1
        h, w = frame_shape

        # Filtrar detecciones por confianza
        valid_detections = [d for d in detections if d['confidence'] >= self.track_thresh]

        # Calcular IoU entre detecciones actuales y tracks anteriores
        matched = {}
        unmatched_dets = list(range(len(valid_detections)))
        unmatched_tracks = list(self.tracks.keys())

        # Matching greedy por IoU
        if valid_detections and self.tracks:
            for track_id in list(self.tracks.keys()):
                best_iou = 0
                best_det_idx = -1

                for det_idx, det in enumerate(valid_detections):
                    iou = self._iou(self.tracks[track_id]['bbox'], det['bbox'])
                    if iou > best_iou:
                        best_iou = iou
                        best_det_idx = det_idx

                if best_iou >= self.match_thresh and best_det_idx >= 0:
                    matched[track_id] = best_det_idx
                    if best_det_idx in unmatched_dets:
                        unmatched_dets.remove(best_det_idx)
                    if track_id in unmatched_tracks:
                        unmatched_tracks.remove(track_id)

        # Actualizar tracks existentes
        active_tracks = {}
        for track_id, det_idx in matched.items():
            det = valid_detections[det_idx]
            self.tracks[track_id]['bbox'] = det['bbox']
            self.tracks[track_id]['confidence'] = det['confidence']
            self.tracks[track_id]['class'] = det['class']
            self.tracks[track_id]['class_id'] = det['class_id']
            self.tracks[track_id]['frames_alive'] += 1
            self.tracks[track_id]['frames_without_detection'] = 0
            active_tracks[track_id] = self.tracks[track_id]

        # Crear nuevos tracks para detecciones no matcheadas
        for det_idx in unmatched_dets:
            det = valid_detections[det_idx]
            self.next_id += 1
            active_tracks[self.next_id] = {
                'id': self.next_id,
                'bbox': det['bbox'],
                'confidence': det['confidence'],
                'class': det['class'],
                'class_id': det['class_id'],
                'frames_alive': 1,
                'frames_without_detection': 0,
                'centroid': self._get_centroid(det['bbox'])
            }

        # Mantener tracks vivos sin detección (hasta track_buffer frames)
        for track_id in unmatched_tracks:
            if track_id in self.tracks:
                self.tracks[track_id]['frames_without_detection'] += 1
                if self.tracks[track_id]['frames_without_detection'] <= self.track_buffer:
                    # Predecir nueva posición (simple: mantener última)
                    active_tracks[track_id] = self.tracks[track_id]

        # Actualizar estado
        self.tracks = active_tracks

        # Preparar output con centroid calculado
        output = []
        for track_id, track_info in active_tracks.items():
            output.append({
                'id': track_id,
                'bbox': track_info['bbox'],
                'centroid': self._get_centroid(track_info['bbox']),
                'confidence': track_info['confidence'],
                'class': track_info['class'],
                'class_id': track_info['class_id'],
                'frames_alive': track_info['frames_alive']
            })

        return output

    def _iou(self, box1, box2):
        """Calcular Intersection over Union entre dos bboxes [x1,y1,x2,y2]"""
        x1_min, y1_min, x1_max, y1_max = box1
        x2_min, y2_min, x2_max, y2_max = box2

        inter_xmin = max(x1_min, x2_min)
        inter_ymin = max(y1_min, y2_min)
        inter_xmax = min(x1_max, x2_max)
        inter_ymax = min(y1_max, y2_max)

        if inter_xmax < inter_xmin or inter_ymax < inter_ymin:
            return 0.0

        inter_area = (inter_xmax - inter_xmin) * (inter_ymax - inter_ymin)
        box1_area = (x1_max - x1_min) * (y1_max - y1_min)
        box2_area = (x2_max - x2_min) * (y2_max - y2_min)
        union_area = box1_area + box2_area - inter_area

        if union_area == 0:
            return 0.0

        return inter_area / union_area

    def _get_centroid(self, bbox):
        """Calcular centroide de un bbox [x1,y1,x2,y2]"""
        x1, y1, x2, y2 = bbox
        return (int((x1 + x2) // 2), int((y1 + y2) // 2))


class LocateAnythingWrapper:
    """
    Wrapper para cargar y usar LocateAnything desde HuggingFace.
    Implementa detección de objetos mediante prompts de texto.
    """

    def __init__(self, model_id: str = "yeezhu/LocateAnything"):
        self.model_id = model_id
        self.predictor = None
        self._load_model()

    def _load_model(self):
        """Cargar modelo de LocateAnything"""
        try:
            try:
                # Intentar importar desde locate-anything
                from locate_anything.locating import LocateAnythingPredictor
                self.predictor = LocateAnythingPredictor()
            except ImportError:
                logger.warning("locate_anything no instalado, intentando alternativa...")
                # Fallback: usar transformers directamente
                from transformers import AutoModelForCausalLM, AutoTokenizer, AutoProcessor
                from PIL import Image

                self.model = AutoModelForCausalLM.from_pretrained(
                    self.model_id,
                    trust_remote_code=True,
                    torch_dtype="auto"
                ).eval()
                self.processor = AutoProcessor.from_pretrained(self.model_id, trust_remote_code=True)
                self.is_transformers = True
                self.predictor = None
                logger.info(f"Modelo LocateAnything cargado desde HuggingFace: {self.model_id}")
        except Exception as e:
            logger.error(f"Error cargando LocateAnything: {e}. Usaremos YOLO como fallback.")
            self.predictor = None

    def detect(self, image: np.ndarray, prompt: str) -> List[Dict]:
        """
        Detectar objetos en imagen según prompt de texto.

        Args:
            image: numpy array BGR (OpenCV format)
            prompt: texto descriptivo (ej: "cow", "person")

        Returns:
            Lista de detecciones con bbox y confidence
        """
        detections = []

        if self.predictor is None and not hasattr(self, 'model'):
            logger.warning("LocateAnything no está disponible, retornando lista vacía")
            return detections

        try:
            if hasattr(self, 'is_transformers') and self.is_transformers:
                # Usar transformers directamente
                from PIL import Image
                import torch

                # Convertir BGR a RGB y PIL
                image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
                pil_image = Image.fromarray(image_rgb)

                # Preparar input
                inputs = self.processor(
                    text=f"<image>locate {prompt}",
                    images=pil_image,
                    return_tensors="pt"
                )

                # Inferencia
                with torch.no_grad():
                    outputs = self.model.generate(**inputs, max_new_tokens=256)

                result = self.processor.decode(outputs[0], skip_special_tokens=True)

                # Parse de resultado (puede variar según modelo)
                # Format esperado: "x1,y1,x2,y2 confidence"
                # Por ahora, retornar detección simple
                h, w = image.shape[:2]
                detections.append({
                    'bbox': [0, 0, w, h],
                    'confidence': 0.8,  # Placeholder
                    'text': result
                })

            elif self.predictor:
                # Usar LocateAnythingPredictor si está disponible
                results = self.predictor.predict_with_prompt(image, prompt)
                for result in results:
                    if result.get('score', 0) > 0.3:
                        detections.append({
                            'bbox': result.get('bbox', [0, 0, image.shape[1], image.shape[0]]),
                            'confidence': result.get('score', 0.5)
                        })

        except Exception as e:
            logger.debug(f"Error en detección LocateAnything: {e}")

        return detections


class VisionEngine:
    """
    Motor de visión con soporte para YOLOv8 (default) y LocateAnything (experimental).
    Mantiene tracking persistente de objetos entre frames.
    """

    def __init__(self, model_path: str = "yolov8n.pt", use_eagle: bool = False,
                 track_buffer: int = 30, track_thresh: float = 0.5):
        """
        Args:
            model_path: Ruta al modelo YOLO o ID de LocateAnything
            use_eagle: Si True, usar LocateAnything; si False, usar YOLO
            track_buffer: Frames para mantener track sin detección
            track_thresh: Threshold de confianza mínimo
        """
        self.use_eagle = use_eagle
        self.frame_count = 0

        # Clases objetivo
        self.target_classes_text = ["cow", "sheep", "person"]
        self.target_classes_ids = [19, 18, 0]  # COCO class IDs

        # Cargar modelo de detección
        if use_eagle:
            logger.info("Inicializando LocateAnything...")
            self.eagle_model = LocateAnythingWrapper(model_path)
            self.yolo_model = None
        else:
            logger.info(f"Inicializando YOLO con {model_path}...")
            self.yolo_model = YOLO(model_path)
            self.eagle_model = None

        # ByteTracker para tracking persistente
        self.tracker = SimpleByteTracker(
            track_buffer=track_buffer,
            track_thresh=track_thresh,
            match_thresh=0.8
        )

        # Historial para debugging
        self.track_history = {}

    def set_classes(self, class_ids: List[int]):
        """Actualizar clases objetivo"""
        self.target_classes_ids = class_ids
        id_to_text = {19: "cow", 18: "sheep", 0: "person"}
        self.target_classes_text = [id_to_text.get(cid, f"cls_{cid}") for cid in class_ids]
        logger.info(f"Clases objetivo actualizadas: {self.target_classes_text}")

    def process_frame(self, frame: np.ndarray) -> Tuple[np.ndarray, List[Dict]]:
        """
        Procesar frame completo: detección + tracking.

        Args:
            frame: numpy array BGR (formato OpenCV)

        Returns:
            (annotated_frame, detections_list)
            - annotated_frame: frame con anotaciones visuales
            - detections_list: [{id, bbox, centroid, class, confidence, class_id}, ...]
        """
        self.frame_count += 1
        h, w = frame.shape[:2]

        # Fase 1: Detección de objetos
        raw_detections = self._detect(frame)

        # Fase 2: Tracking persistente
        tracked_detections = self.tracker.update(raw_detections, (h, w))

        # Fase 3: Anotación visual
        annotated_frame = self._annotate(frame, tracked_detections)

        return annotated_frame, tracked_detections

    def _detect(self, frame: np.ndarray) -> List[Dict]:
        """Detectar objetos en frame"""
        detections = []

        if self.use_eagle and self.eagle_model:
            # LocateAnything: hacer query para cada clase
            for class_idx, class_text in enumerate(self.target_classes_text):
                dets = self.eagle_model.detect(frame, class_text)
                for det in dets:
                    detections.append({
                        'bbox': det.get('bbox', [0, 0, frame.shape[1], frame.shape[0]]),
                        'confidence': det.get('confidence', 0.7),
                        'class': class_text,
                        'class_id': self.target_classes_ids[class_idx]
                    })

        elif self.yolo_model:
            # YOLO: detección estándar
            results = self.yolo_model.predict(
                frame,
                classes=self.target_classes_ids,
                verbose=False
            )

            if results and len(results) > 0:
                boxes = results[0].boxes
                if boxes is not None:
                    for box in boxes:
                        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
                        conf = float(box.conf[0].cpu().numpy())
                        cls_id = int(box.cls[0].cpu().numpy())

                        detections.append({
                            'bbox': [int(x1), int(y1), int(x2), int(y2)],
                            'confidence': conf,
                            'class': self._get_class_name(cls_id),
                            'class_id': cls_id
                        })

        return detections

    def _annotate(self, frame: np.ndarray, detections: List[Dict]) -> np.ndarray:
        """Anotar frame con bboxes y información de tracking"""
        annotated = frame.copy()

        for det in detections:
            x1, y1, x2, y2 = det['bbox']
            track_id = det['id']
            class_name = det['class']
            conf = det['confidence']

            # Color según clase
            color = self._get_color_for_class(class_name)

            # Dibujar bbox
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

            # Dibujar etiqueta con ID + clase + confianza
            label = f"ID:{track_id} {class_name} {conf:.2f}"
            cv2.putText(annotated, label, (x1, y1 - 10),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

            # Dibujar centroide
            cx, cy = det['centroid']
            cv2.circle(annotated, (cx, cy), 3, color, -1)

        return annotated

    def _get_class_name(self, class_id: int) -> str:
        """Mapear class_id COCO a nombre"""
        mapping = {19: "cow", 18: "sheep", 0: "person"}
        return mapping.get(class_id, f"unknown_{class_id}")

    def _get_color_for_class(self, class_name: str) -> Tuple[int, int, int]:
        """Color BGR para visualización por clase"""
        colors = {
            "cow": (0, 255, 0),      # Verde
            "sheep": (255, 0, 0),    # Azul
            "person": (0, 0, 255)    # Rojo
        }
        return colors.get(class_name, (128, 128, 128))  # Gris por defecto
