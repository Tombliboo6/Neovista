# 🎨 NeoVista AI Studio

**NeoVista AI Studio** is a powerful AI-powered image generation platform that combines a FastAPI backend with a Streamlit frontend. It leverages Google's **Gemini models** to generate high-quality images from text prompts, offering features like prompt optimization, image upscaling, and a community gallery.

## ✨ Features

- **Text-to-Image Generation**: Generate images using Google's advanced Gemini models.
- **AI Inspiration Assistant**: An interactive chat interface to help refine your prompts and brainstorm ideas.
- **Prompt Optimization**: Automatically translates and enhances your prompts for better generation results.
- **Image Upscaling**: Automatically upscales generated images (2x) for high-resolution downloads.
- **Gallery System**:
    - **Personal History**: View your recently generated images.
    - **Public Gallery**: Submit your best creations to a shared gallery.
    - **Social Features**: Like, Favorite, and Comment on gallery items.
    - **"Make Same Style"**: One-click to copy prompts and settings from gallery images.
- **Reference Image Support**: Upload reference images to guide the AI's generation (Image-to-Image).

## 🛠️ Tech Stack

- **Frontend**: [Streamlit](https://streamlit.io/)
- **Backend**: [FastAPI](https://fastapi.tiangolo.com/)
- **AI Model**: Google Gemini (via `google-genai` SDK)
- **Database**: SQLite
- **Image Processing**: Pillow (PIL)

## 📂 Project Structure

```
backend/
├── images/               # Storage for generated images
├── pages/                # Streamlit pages (e.g., Admin dashboard)
├── gallery.db            # SQLite database for gallery data
├── main.py               # FastAPI backend entry point
├── web_app.py            # Streamlit frontend entry point
├── requirements.txt      # Python dependencies
└── README.md             # Project documentation
```

## 🚀 Getting Started

### Prerequisites

- Python 3.12 or higher
- A Google Gemini API Key (Get it from [Google AI Studio](https://aistudio.google.com/))

### Installation

1.  **Clone the repository**
    ```bash
    git clone <your-repo-url>
    cd backend
    ```

2.  **Create and activate a virtual environment**
    ```bash
    # Linux/macOS
    python3 -m venv venv
    source venv/bin/activate

    # Windows
    python -m venv venv
    .\venv\Scripts\activate
    ```

3.  **Install dependencies**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Configure API Key**
    Open `main.py` and replace the placeholder API key with your actual key (or set it as an environment variable for security):
    ```python
    # main.py
    API_KEY = "YOUR_GEMINI_API_KEY"
    ```

### ▶️ Usage

You need to run both the backend and frontend services.

**1. Start the Backend (FastAPI)**
```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```
The API will run at `http://localhost:8000`.

**2. Start the Frontend (Streamlit)**
Open a new terminal and run:
```bash
streamlit run web_app.py
```
The web interface will open automatically at `http://localhost:8501`.

## 📝 License

This project is open-source and available under the MIT License.
