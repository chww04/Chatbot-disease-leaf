FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy service code
COPY cv_service.py .

# Model will be downloaded from GCS at startup
# Set environment variables
ENV PORT=5001
ENV PYTHONUNBUFFERED=1

EXPOSE 5001

CMD ["python", "cv_service.py"]
