from flask import Flask, request, render_template, jsonify, session
import os
import pypdf
import pandas as pd
from io import BytesIO
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import uuid
import psycopg2
from psycopg2.extras import RealDictCursor
import requests

app = Flask(__name__)
app.secret_key = os.urandom(24)

MAX_HISTORY_ITEMS = 6

# Load BERT-based semantic search model
print("Loading BERT model...")
semantic_model = SentenceTransformer('paraphrase-MiniLM-L6-v2')
print("BERT model loaded!")

# Server-side storage (in-memory, local to your laptop)
conversations = {}
documents = {}
qna_embeddings_cache = {}

# Database configuration - set these as environment variables on your lab server
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_NAME = os.getenv('DB_NAME', 'chatwithnotes')
DB_USER = os.getenv('DB_USER', 'chatuser')
DB_PASSWORD = os.getenv('DB_PASSWORD', 'yourpassword')

def get_db_connection():
    """Create PostgreSQL database connection"""
    return psycopg2.connect(
        host=DB_HOST,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )

def fetch_qna_from_db():
    """Fetch all Q&A pairs from PostgreSQL"""
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("SELECT question, answer FROM qna_pairs")
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    
    # Convert to dict format for compatibility
    qna_dict = {row['question']: row['answer'] for row in rows}
    return qna_dict

def parse_qna_pairs(content):
    """Parse Q&A pairs from Excel data into a dict"""
    qna_dict = {}
    lines = content.split('\n')
    current_q = None
    
    for line in lines:
        if line.startswith('Q:'):
            current_q = line[2:].strip()
        elif line.startswith('A:') and current_q:
            answer = line[2:].strip()
            if answer:
                qna_dict[current_q] = answer
            current_q = None
    
    return qna_dict

def find_top_matches(user_query, qna_dict, session_id=None, top_k=3):
    """Find top K matching Q&A pairs using BERT semantic search"""
    if not qna_dict:
        return []
    
    questions = list(qna_dict.keys())
    
    # Use cached embeddings if available
    if session_id and session_id in qna_embeddings_cache:
        question_embeddings = qna_embeddings_cache[session_id]
    else:
        # Embed all questions with BERT
        question_embeddings = semantic_model.encode(questions, convert_to_tensor=False)
        if session_id:
            qna_embeddings_cache[session_id] = question_embeddings
    
    # Embed user query with BERT
    query_embedding = semantic_model.encode([user_query], convert_to_tensor=False)
    
    # Find most similar questions
    similarities = cosine_similarity(query_embedding, question_embeddings)[0]
    top_indices = np.argsort(similarities)[::-1][:top_k]
    
    # Return top matches with scores
    matches = []
    for idx in top_indices:
        score = similarities[idx]
        if score > 0.35:
            matches.append({
                'question': questions[idx],
                'answer': qna_dict[questions[idx]],
                'score': float(score)
            })
    
    return matches

def generate_response(prompt, conversation_history, file_content, session_id=None):
    # For Q&A data, use BERT search + deterministic structure + optional LLM tone rewrite
    if file_content.strip().startswith("Data:"):
        qna_dict = fetch_qna_from_db()  # Fetch from DB instead
        top_matches = find_top_matches(prompt, qna_dict, session_id, top_k=3)
        
        if not top_matches:
            return "No relevant Q&A pairs found in the database. Try rephrasing your question."
        
        # Always return best match (highest score) - deterministic structure
        best_match = top_matches[0]
        confidence_pct = round(best_match['score'] * 100, 1)

        # Build response with best answer and related answers
        response = f"""<span style="color: green;">
**🟢 BEST ANSWER:** {best_match['answer']}

**Source Q:** {best_match['question']}
**Confidence:** {confidence_pct}%
</span>"""

        # If there are related answers, add them with clear spacing
        if len(top_matches) > 1:
            related = "\n\n---\n\n**RELATED ANSWERS:**\n"
            for i, match in enumerate(top_matches[1:], 1):
                conf = round(match['score'] * 100, 1)
                related += f"\n**Related {i}** ({conf}% match)\n**Q:** {match['question']}\n**A:** {match['answer']}\n"
            response += related

        return response
    
    # For other documents, use TinyLlama
    if not file_content:
        return "Please upload a document first."
    
    system_prompt = """You are a Q&A assistant that answers questions based on the provided document. 
You must:
- Only use information from the provided document
- Never use your training data or outside knowledge
- If the answer is not in the document, explicitly say so
- Provide thorough, detailed answers"""
    
    full_prompt = f"{system_prompt}\n\nDocument:\n{file_content}\n\nQuestion: {prompt}\n\nAnswer (only from document, thorough and detailed):"
    url = 'http://localhost:11434/v1/completions'
    headers = {'Content-Type': 'application/json'}
    data = {
        'prompt': full_prompt,
        'model': 'tinyllama',
        'max_tokens': 4096,
        'temperature': 0.3,
        'stream': False
    }
    try:
        response = requests.post(url, headers=headers, json=data, timeout=90)
        if response.status_code == 200:
            return response.json()['choices'][0]['text'].strip()
        else:
            return f"Error: {response.status_code}"
    except Exception as e:
        return f"Error: {str(e)[:100]}"

def allowed_file(filename):
    ALLOWED_EXTENSIONS = {'txt', 'md', 'py', 'js', 'html', 'css', 'json', 'pdf', 'xlsx', 'xls', 'csv'}
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_file_content(file):
    filename = file.filename or ''
    lower_name = filename.lower()
    if lower_name.endswith('.pdf'):
        pdf_reader = pypdf.PdfReader(file)
        content = ""
        for page in pdf_reader.pages:
            content += page.extract_text()
        return content, False
    if lower_name.endswith(('.xlsx', '.xls', '.csv')):
        if lower_name.endswith('.csv'):
            df = pd.read_csv(file, header=None)
        else:
            df = pd.read_excel(file, header=None)

        content = "Data:\n"
        if df.shape[1] >= 2:
            for _, row in df.iterrows():
                q, a = row.iloc[0], row.iloc[1]
                if pd.isna(q) and pd.isna(a):
                    continue
                content += f"Q: {q if not pd.isna(q) else ''}\nA: {a if not pd.isna(a) else ''}\n"
        else:
            content = df.to_string()
        return content, True

    content = file.read().decode('utf-8')
    return content, False

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'})
    files = request.files.getlist('file')
    if not files or all(not f.filename for f in files):
        return jsonify({'error': 'No selected file'})

    for file in files:
        if file.filename and not allowed_file(file.filename):
            return jsonify({'error': 'File type not allowed'})

    try:
        qna_parts = []
        non_qna_parts = []

        for file in files:
            if not file.filename:
                continue
            content, is_qna = extract_file_content(file)
            header = f"--- {file.filename} ---\n"
            if is_qna:
                qna_parts.append((file.filename, content))
            else:
                non_qna_parts.append(header + content)

        if qna_parts and not non_qna_parts:
            combined_qna = "Data:\n"
            for _, qna_content in qna_parts:
                combined_qna += qna_content.replace("Data:\n", "", 1).strip() + "\n"
            content = combined_qna.strip()
        else:
            combined_parts = list(non_qna_parts)
            for filename, qna_content in qna_parts:
                qna_text = qna_content.replace("Data:\n", "", 1).strip()
                combined_parts.append(f"--- {filename} (Q&A) ---\n{qna_text}")
            content = "\n\n".join(combined_parts).strip()

        action = request.form.get('action', 'upload')
        session_id = session.get('session_id') or str(uuid.uuid4())
        session['session_id'] = session_id

        if action == 'clear':
            conversations[session_id] = []
        elif action != 'keep':
            conversations[session_id] = []

        documents[session_id] = content
        qna_embeddings_cache.pop(session_id, None)
        return jsonify({
            'content': content,
            'chatHistory': conversations.get(session_id, [])
        })
    except Exception as e:
        return jsonify({'error': f'Error: {str(e)[:100]}'})

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    user_input = data['message']
    session_id = session.get('session_id') or str(uuid.uuid4())
    session['session_id'] = session_id
    
    conversation_history = conversations.get(session_id, [])
    file_content = documents.get(session_id, '')

    conversation_history.append(f"Human: {user_input}")
    ai_response = generate_response(user_input, conversation_history, file_content, session_id)
    conversation_history.append(f"AI: {ai_response}")

    conversations[session_id] = conversation_history

    return jsonify({
        'response': ai_response,
        'full_history': conversation_history
    })

@app.route('/clear_chat', methods=['POST'])
def clear_chat():
    session_id = session.get('session_id')
    if session_id:
        conversations[session_id] = []
    return jsonify({'status': 'success', 'message': 'Chat history cleared'})

@app.route('/clear_all', methods=['POST'])
def clear_all():
    session_id = session.get('session_id')
    if session_id:
        conversations.pop(session_id, None)
        documents.pop(session_id, None)
        qna_embeddings_cache.pop(session_id, None)
    session.clear()
    return jsonify({'status': 'success', 'message': 'All data cleared'})

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000, debug=False)
