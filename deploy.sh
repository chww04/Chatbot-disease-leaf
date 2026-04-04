#!/bin/bash
# ============================================================
# Full Deployment Script
# CV Model → GCS → Cloud Run → Vertex AI Endpoint
# ============================================================
# Usage: bash deploy.sh
# Run from your project root folder

set -e  # Exit on any error

# ── CONFIGURE THESE ──────────────────────────────────────────
PROJECT_ID="melvin-ai-490502"
REGION="us-central1"
GCS_BUCKET="leaf_disease1"
MODEL_GCS_PATH="models/rice_disease_model.keras"
SERVICE_NAME="cv-disease-service"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"
# ─────────────────────────────────────────────────────────────

echo "============================================"
echo " PhytoScan CV Model Deployment"
echo "============================================"
echo "Project:  $PROJECT_ID"
echo "Region:   $REGION"
echo "Bucket:   $GCS_BUCKET"
echo ""

# Step 1: Check model file exists locally
echo "[1/6] Checking for rice_disease_model.keras..."
if [ ! -f "rice_disease_model.keras" ]; then
    echo "ERROR: rice_disease_model.keras not found!"
    echo "Please download it from Google Colab/Drive first."
    exit 1
fi
echo "Model file found!"

# Step 2: Upload model to GCS
echo ""
echo "[2/6] Uploading model to GCS..."
gcloud storage cp rice_disease_model.keras gs://$GCS_BUCKET/$MODEL_GCS_PATH
echo "Model uploaded to gs://$GCS_BUCKET/$MODEL_GCS_PATH"

# Step 3: Build and push Docker image
echo ""
echo "[3/6] Building Docker image..."
gcloud builds submit \
    --tag $IMAGE_NAME \
    --project $PROJECT_ID

echo "Docker image built: $IMAGE_NAME"

# Step 4: Deploy to Cloud Run
echo ""
echo "[4/6] Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
    --image $IMAGE_NAME \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --port 5001 \
    --memory 2Gi \
    --cpu 2 \
    --timeout 120 \
    --set-env-vars GCS_BUCKET=$GCS_BUCKET,MODEL_GCS_PATH=$MODEL_GCS_PATH \
    --project $PROJECT_ID

# Get Cloud Run URL
CLOUD_RUN_URL=$(gcloud run services describe $SERVICE_NAME \
    --region $REGION \
    --project $PROJECT_ID \
    --format "value(status.url)")

echo ""
echo "Cloud Run deployed at: $CLOUD_RUN_URL"

# Step 5: Test Cloud Run health
echo ""
echo "[5/6] Testing Cloud Run health endpoint..."
sleep 5
curl -s "$CLOUD_RUN_URL/health" | python3 -m json.tool || echo "Health check failed - service may still be starting"

# Step 6: Create Vertex AI Endpoint
echo ""
echo "[6/6] Setting up Vertex AI Endpoint..."

# Upload model to Vertex AI Model Registry
gcloud ai models upload \
    --region=$REGION \
    --display-name="rice-disease-cv-model" \
    --container-image-uri=$IMAGE_NAME \
    --container-ports=5001 \
    --container-health-route=/health \
    --container-predict-route=/ \
    --project=$PROJECT_ID

# Get the model ID
MODEL_ID=$(gcloud ai models list \
    --region=$REGION \
    --project=$PROJECT_ID \
    --filter="displayName=rice-disease-cv-model" \
    --format="value(name)" | head -1)

echo "Vertex AI Model ID: $MODEL_ID"

# Create endpoint
gcloud ai endpoints create \
    --region=$REGION \
    --display-name="rice-disease-endpoint" \
    --project=$PROJECT_ID

# Get endpoint ID
ENDPOINT_ID=$(gcloud ai endpoints list \
    --region=$REGION \
    --project=$PROJECT_ID \
    --filter="displayName=rice-disease-endpoint" \
    --format="value(name)" | head -1)

echo "Vertex AI Endpoint ID: $ENDPOINT_ID"

# Deploy model to endpoint
gcloud ai endpoints deploy-model $ENDPOINT_ID \
    --region=$REGION \
    --model=$MODEL_ID \
    --display-name="rice-disease-deployment" \
    --machine-type=n1-standard-2 \
    --min-replica-count=1 \
    --max-replica-count=2 \
    --project=$PROJECT_ID

echo ""
echo "============================================"
echo " DEPLOYMENT COMPLETE!"
echo "============================================"
echo ""
echo "Cloud Run URL:      $CLOUD_RUN_URL"
echo "Vertex AI Endpoint: $ENDPOINT_ID"
echo ""
echo "Add to your .env.local:"
echo "CV_SERVICE_URL=$CLOUD_RUN_URL"
echo "VERTEX_ENDPOINT_ID=$ENDPOINT_ID"
echo "============================================"
