from flask import Flask, request, jsonify
from flask_cors import CORS
import tensorflow as tf
import numpy as np
from PIL import Image
from pathlib import Path

app = Flask(__name__)
CORS(app)

MODEL_PATH = Path(__file__).with_name("model.h5")
model = None


def get_model():
    global model

    if model is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Model file not found: {MODEL_PATH}")
        model = tf.keras.models.load_model(MODEL_PATH)

    return model

def preprocess(image):
    image = image.resize((224, 224))  # change if needed
    image = np.array(image) / 255.0
    image = np.expand_dims(image, axis=0)
    return image

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ok",
        "modelAvailable": MODEL_PATH.exists()
    })

@app.route('/predict', methods=['POST'])
def predict():
    if 'image' not in request.files:
        return jsonify({"error": "Missing image file"}), 400

    try:
        loaded_model = get_model()
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 503

    file = request.files['image']
    image = Image.open(file).convert('RGB')

    processed = preprocess(image)
    prediction = loaded_model.predict(processed)[0][0]

    return jsonify({
        "condition": "Cataract" if prediction > 0.5 else "Normal",
        "confidence": float(prediction * 100)
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
