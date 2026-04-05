"""
CV Model Microservice for Cloud Run
- Downloads model from GCS on startup
- Exposes /predict endpoint
- Compatible with Vertex AI endpoint format
"""

import os
import base64
import io
import json
import numpy as np
from flask import Flask, request, jsonify
from PIL import Image
import tensorflow as tf
import keras
from google.cloud import storage

app = Flask(__name__)

# ── CONFIG ────────────────────────────────────────────────────────────────────
GCS_BUCKET   = os.environ.get("GCS_BUCKET", "leaf_disease1")
MODEL_GCS_PATH = os.environ.get("MODEL_GCS_PATH", "models/rice_disease_model.keras")
LOCAL_MODEL_PATH = "/tmp/rice_disease_model.keras"
CLASS_LABELS = ["Bacterialblight", "Blast", "Brownspot", "Tungro"]
IMG_SIZE     = (224, 224)
PORT         = int(os.environ.get("PORT", 5001))
# ─────────────────────────────────────────────────────────────────────────────

DISEASE_INFO = {
    "Bacterialblight": {
        "fullName": "Bacterial Blight",
        "pathogen": "Xanthomonas oryzae pv. oryzae",
        "symptoms": "Water-soaked to yellowish stripe on leaf margins, wilting, milky dew drops",
        "severity": "High — can cause 20-30% yield loss",
        "treatment": "Copper-based bactericides, seed treatment with bleaching powder, remove infected plants",
        "prevention": "Use resistant varieties, balanced fertilization, avoid excess nitrogen"
    },
    "Blast": {
        "fullName": "Rice Blast",
        "pathogen": "Magnaporthe oryzae",
        "symptoms": "Diamond-shaped lesions with grey centers and brown borders on leaves",
        "severity": "Very High — most destructive rice disease, up to 50% yield loss",
        "treatment": "Tricyclazole or isoprothiolane fungicides, silicon fertilization",
        "prevention": "Resistant varieties, avoid dense planting, silicon amendments, balanced nitrogen"
    },
    "Brownspot": {
        "fullName": "Brown Spot",
        "pathogen": "Cochliobolus miyabeanus (Bipolaris oryzae)",
        "symptoms": "Circular to oval brown spots with yellow halo, dark spots on grain",
        "severity": "Moderate — associated with nutrient-deficient soils",
        "treatment": "Mancozeb or iprodione fungicides, potassium and silicon supplementation",
        "prevention": "Balanced fertilization especially potassium, treat seeds with fungicide"
    },
    "Tungro": {
        "fullName": "Rice Tungro Disease",
        "pathogen": "Rice Tungro Bacilliform Virus (RTBV) + Rice Tungro Spherical Virus (RTSV)",
        "symptoms": "Yellow to orange-yellow leaf discoloration, stunted growth, mottled leaves",
        "severity": "High — vector-transmitted, up to 100% loss in severe cases",
        "treatment": "No direct cure — control green leafhopper vector with imidacloprid or BPMC",
        "prevention": "Resistant varieties, synchronous planting, control leafhopper populations"
    }
}

# ── Load model from GCS ───────────────────────────────────────────────────────
def download_model_from_gcs():
    """Download Keras model from GCS bucket to local /tmp."""
    if os.path.exists(LOCAL_MODEL_PATH):
        print(f"Model already exists at {LOCAL_MODEL_PATH}")
        return True
    try:
        print(f"Downloading model from gs://{GCS_BUCKET}/{MODEL_GCS_PATH}...")
        client = storage.Client()
        bucket = client.bucket(GCS_BUCKET)
        blob = bucket.blob(MODEL_GCS_PATH)
        blob.download_to_filename(LOCAL_MODEL_PATH)
        print("Model downloaded successfully!")
        return True
    except Exception as e:
        print(f"ERROR downloading model: {e}")
        return False

print("Starting CV Service...")
model_ready = download_model_from_gcs()

if model_ready:
    try:
        model = tf.keras.models.load_model(LOCAL_MODEL_PATH, compile=False)
        print("Model loaded successfully!")
    except Exception as e:
        print(f"ERROR loading model: {e}")
        model = None
else:
    model = None

# ── Helpers ───────────────────────────────────────────────────────────────────
def preprocess_image(image_data: str) -> np.ndarray:
    if "," in image_data:
        image_data = image_data.split(",")[1]
    img_bytes = base64.b64decode(image_data)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    img = img.resize(IMG_SIZE)
    arr = np.array(img) / 255.0
    return np.expand_dims(arr, axis=0)

# ── Routes ────────────────────────────────────────────────────────────────────
@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "model_loaded": model is not None,
        "gcs_bucket": GCS_BUCKET,
        "model_path": MODEL_GCS_PATH
    })

@app.route("/predict", methods=["POST"])
def predict():
    """Smart prediction with fallback support."""
    try:
        data = request.get_json()
        if not data or "image" not in data:
            return jsonify({"error": "image field required"}), 400

        image_array = preprocess_image(data["image"])

        if model is None:
            return jsonify({"error": "Model not loaded"}), 503

        predictions = model.predict(image_array, verbose=0)[0]
        predicted_idx = int(np.argmax(predictions))
        predicted_class = CLASS_LABELS[predicted_idx]
        confidence = float(predictions[predicted_idx])

        all_scores = {
            CLASS_LABELS[i]: float(predictions[i])
            for i in range(len(CLASS_LABELS))
        }

        disease_data = DISEASE_INFO.get(predicted_class, {})

        
        HIGH_CONF_THRESHOLD = 0.75
        LOW_CONF_THRESHOLD = 0.50

        if confidence >= HIGH_CONF_THRESHOLD:
            decision = "use_model"  
        elif confidence < LOW_CONF_THRESHOLD:
            decision = "fallback"    
        else:
            decision = "uncertain"  

        return jsonify({
            "source": "rice_model",
            "decision": decision,
            "predictedClass": predicted_class,
            "confidence": round(confidence, 4),
            "allScores": all_scores,
            "diseaseInfo": disease_data,
            "isHighConfidence": confidence >= HIGH_CONF_THRESHOLD,
            "isRiceLikely": confidence >= LOW_CONF_THRESHOLD
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/", methods=["POST"])
def vertex_predict():
    """
    Vertex AI compatible endpoint.
    Vertex AI sends requests in format: {"instances": [...]}
    """
    try:
        data = request.get_json()

        # Handle Vertex AI format
        if "instances" in data:
            instance = data["instances"][0]
            image_data = instance.get("image") or instance.get("b64")
        else:
            image_data = data.get("image")

        if not image_data:
            return jsonify({"error": "No image data found"}), 400

        image_array = preprocess_image(image_data)

        if model is None:
            return jsonify({"error": "Model not loaded"}), 503

        predictions = model.predict(image_array, verbose=0)[0]
        predicted_idx = int(np.argmax(predictions))
        predicted_class = CLASS_LABELS[predicted_idx]
        confidence = float(predictions[predicted_idx])
        all_scores = {CLASS_LABELS[i]: float(predictions[i]) for i in range(len(CLASS_LABELS))}

        disease_data = DISEASE_INFO.get(predicted_class, {})

        result = {
            "predictedClass": predicted_class,
            "confidence": round(confidence, 4),
            "allScores": all_scores,
            "diseaseInfo": disease_data,
            "isHighConfidence": confidence >= 0.70
        }

        # Vertex AI expects {"predictions": [...]}
        return jsonify({"predictions": [result]})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    print(f"CV Service running on port {PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
