# README1 — Excel Q&A Usage (app_bert.py)

This guide explains how to run [app_bert.py](app_bert.py) and use Excel/CSV files for Q&A search.

## What this does
- Upload an Excel/CSV file with Q&A pairs.
- The app parses rows into `Q:` / `A:` pairs.
- It uses a BERT model to find the best-matching answer.

## Prerequisites
- Python 3.9+ recommended
- Dependencies installed (see `requirements.txt`)

## Install dependencies
```bash
pip install -r requirements.txt
```

## Run the app
```bash
python app_bert.py
```

Then open your browser at:
```
http://127.0.0.1:5000
```

## Excel / CSV format
Your file should have **at least two columns**:

| Column A (Question) | Column B (Answer) |
|---|---|
| What is X? | X is ... |
| How do I Y? | You can Y by ... |

- **Column A** = Question  
- **Column B** = Answer  
- Extra columns are ignored.

CSV is supported the same way (first two columns used).

## Upload steps
1. Click upload in the web UI.
2. Select your `.xlsx`, `.xls`, or `.csv`.
3. Ask a question in the chat box.

## How matching works
- The app embeds questions with a BERT model.
- It returns the best match plus related answers.
- If similarity is low, it may rewrite the best answer for clarity.

## Notes
- Data is stored in memory for the session only.
- Clearing the chat does not remove the uploaded document.
- “Clear all” removes both chat history and the uploaded document.

## Troubleshooting
- If you see “File type not allowed,” confirm the extension is `.xlsx`, `.xls`, or `.csv`.
- If no answers match, try rephrasing your question.
