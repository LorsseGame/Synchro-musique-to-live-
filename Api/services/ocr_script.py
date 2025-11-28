from doctr.io import DocumentFile
from doctr.models import ocr_predictor
import sys
import os
import time
import warnings

# Suppress warnings
warnings.filterwarnings("ignore")
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'  # Suppress TensorFlow logs if present

# Global docTR predictor instance - initialized once and reused
# This saves several seconds per call by avoiding model reloading
_ocr_predictor = None

def get_ocr_predictor():
    """Get or create the global docTR OCR predictor instance.
    
    docTR Configuration:
    - det_arch: Detection architecture (db_resnet50 for best accuracy/speed balance)
    - reco_arch: Recognition architecture (crnn_vgg16_bn for speed, parseq for accuracy)
    - pretrained: Use pretrained models
    - assume_straight_pages: Set to True if text is mostly horizontal (faster)
    - detect_orientation: Enable rotation detection if needed
    - straighten_pages: Auto-correct page rotation
    
    Returns:
        OCR predictor instance
    """
    global _ocr_predictor
    if _ocr_predictor is None:
        start_time = time.time()
        try:
            # Detect if GPU (CUDA) is available
            import torch
            print(f"[OCR] PyTorch version: {torch.__version__}", file=sys.stderr)
            print(f"[OCR] CUDA available: {torch.cuda.is_available()}", file=sys.stderr)
            if torch.cuda.is_available():
                print(f"[OCR] CUDA device: {torch.cuda.get_device_name(0)}", file=sys.stderr)
            
            use_cuda = torch.cuda.is_available()
            
            if use_cuda:
                print("[OCR] GPU detected, using CUDA acceleration", file=sys.stderr)
            else:
                print("[OCR] No GPU detected, using CPU", file=sys.stderr)
            
            # Initialize docTR OCR predictor
            # For best speed/accuracy balance:
            # - Detection: db_resnet50 (faster than db_resnet34, good accuracy)
            # - Recognition: crnn_vgg16_bn (fast) or parseq (more accurate but slower)
            _ocr_predictor = ocr_predictor(
                det_arch='db_resnet50',           # Detection model (db_resnet50, db_mobilenet_v3_large)
                reco_arch='crnn_vgg16_bn',        # Recognition model (crnn_vgg16_bn, parseq, master)
                pretrained=True,                   # Use pretrained weights
                assume_straight_pages=True,        # Assume horizontal text (faster)
                detect_orientation=False,          # Disable orientation detection for speed
                straighten_pages=False,            # Disable page straightening for speed
                export_as_straight_boxes=False,    # Don't force straight boxes
                detect_language=False              # Disable language detection for speed
            )
            
            # Move to GPU if available
            if use_cuda:
                _ocr_predictor.cuda()
            
            load_time = time.time() - start_time
            print(f"[OCR] docTR initialized in {load_time:.2f}s", file=sys.stderr)
            
        except Exception as e:
            print(f"[OCR] Error initializing docTR: {e}", file=sys.stderr)
            print(f"[OCR] Tip: Install with 'pip install python-doctr[torch]'", file=sys.stderr)
            raise
    
    return _ocr_predictor

def recognize_text(image_path):
    """Recognize text in an image using docTR.
    
    Args:
        image_path: Path to the image file
        
    Returns:
        str: Detected text, or empty string if no text or on error
    """
    if not os.path.exists(image_path):
        print(f"[OCR] Error: Image not found: {image_path}", file=sys.stderr)
        return ""

    try:
        predictor = get_ocr_predictor()
        
        # Load document
        start_time = time.time()
        doc = DocumentFile.from_images(image_path)
        
        # Perform OCR
        result = predictor(doc)
        ocr_time = time.time() - start_time
        
        # Extract text from result
        # docTR returns hierarchical structure: pages -> blocks -> lines -> words
        detected_texts = []
        
        if result and len(result.pages) > 0:
            for page in result.pages:
                for block in page.blocks:
                    for line in block.lines:
                        # Extract text from each line
                        line_text = " ".join([word.value for word in line.words])
                        if line_text.strip():
                            detected_texts.append(line_text.strip())
        
        # Join all detected text
        full_text = " ".join(detected_texts)
        
        word_count = sum(len(block.lines[0].words) for page in result.pages 
                        for block in page.blocks if block.lines)
        
        print(f"[OCR] Processed in {ocr_time:.2f}s: {len(full_text)} chars, {len(detected_texts)} lines, {word_count} words", 
              file=sys.stderr)
        
        return full_text
        
    except Exception as e:
        print(f"[OCR] Error during recognition: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return ""

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python ocr_script.py <image_path>")
        sys.exit(1)

    image_path = sys.argv[1]
    text = recognize_text(image_path)
    # Print the result to stdout for Node.js to capture
    print(text)
