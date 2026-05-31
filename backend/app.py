from pathlib import Path

import timm
import torch
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image
from torch import nn
from torchvision import transforms

app = Flask(__name__)
CORS(app)

MODEL_PATH = Path(__file__).with_name("best_model.pth.zip")
CLASS_NAMES = ["Normal", "Cataract"]
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

model = None
preprocess = transforms.Compose(
    [
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ]
)


class ClassificationHead(nn.Module):
    def __init__(self):
        super().__init__()
        self.mlp = nn.Sequential(
            nn.Linear(768, 512),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(512, 256),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(256, len(CLASS_NAMES)),
        )

    def forward(self, x):
        return self.mlp(x)


class CataractModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.swin = timm.create_model(
            "swin_tiny_patch4_window7_224",
            pretrained=False,
            num_classes=0,
        )
        self.head = ClassificationHead()

    def forward(self, x):
        features = self.swin(x)
        return self.head(features)


def get_model():
    global model

    if model is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Model file not found: {MODEL_PATH}")

        loaded_model = CataractModel().to(DEVICE)
        state_dict = torch.load(MODEL_PATH, map_location=DEVICE, weights_only=True)
        loaded_model.load_state_dict(state_dict)
        loaded_model.eval()
        model = loaded_model

    return model


def run_prediction(image):
    loaded_model = get_model()
    tensor = preprocess(image).unsqueeze(0).to(DEVICE)

    with torch.inference_mode():
        logits = loaded_model(tensor)
        probabilities = torch.softmax(logits, dim=1)[0].detach().cpu()

    predicted_index = int(torch.argmax(probabilities).item())
    condition = CLASS_NAMES[predicted_index]
    confidence = round(float(probabilities[predicted_index].item() * 100), 2)

    return {
        "condition": condition,
        "confidence": confidence,
        "status": "Positive" if condition == "Cataract" else "Negative",
        "severity": "Needs ophthalmologist review" if condition == "Cataract" else "Optimal",
        "probabilities": {
            CLASS_NAMES[index]: round(float(probability.item() * 100), 2)
            for index, probability in enumerate(probabilities)
        },
    }


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "modelAvailable": MODEL_PATH.exists(),
            "modelPath": str(MODEL_PATH),
            "device": str(DEVICE),
        }
    )


@app.route("/predict", methods=["POST"])
def predict():
    if "image" not in request.files:
        return jsonify({"error": "Missing image file"}), 400

    try:
        image = Image.open(request.files["image"]).convert("RGB")
        result = run_prediction(image)
        return jsonify(result)
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 503
    except Exception as exc:
        return jsonify({"error": f"Prediction failed: {exc}"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
