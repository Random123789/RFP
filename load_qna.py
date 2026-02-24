import pandas as pd
import psycopg2
import os

# Database connection - uses same environment variables as app_bert.py
conn = psycopg2.connect(
    host=os.getenv('DB_HOST', 'localhost'),
    database=os.getenv('DB_NAME', 'chatwithnotes'),
    user=os.getenv('DB_USER', 'chatuser'),
    password=os.getenv('DB_PASSWORD', 'your_password')
)
cursor = conn.cursor()

# Read your Excel file
df = pd.read_excel('RFP testing.xlsx', header=None)  # or use pd.read_csv() for CSV

# Insert each Q&A pair, skip if exact match exists
inserted = 0
skipped = 0

for _, row in df.iterrows():
    question = row.iloc[0]
    
    # Concatenate columns 2 and 3 for answer (handling missing values)
    col2 = str(row.iloc[1]) if not pd.isna(row.iloc[1]) else ""
    col3 = str(row.iloc[2]) if len(row) > 2 and not pd.isna(row.iloc[2]) else ""
    
    # Combine them, removing extra whitespace
    answer = (col2 + " " + col3).strip()
    
    # Skip empty rows
    if pd.isna(question) or not answer:
        continue
    
    # Check if BOTH question AND answer already exist
    cursor.execute(
        "SELECT COUNT(*) FROM qna_pairs WHERE question = %s AND answer = %s",
        (question, answer)
    )
    
    if cursor.fetchone()[0] == 0:  # Doesn't exist, insert it
        cursor.execute(
            "INSERT INTO qna_pairs (question, answer) VALUES (%s, %s)",
            (question, answer)
        )
        inserted += 1
    else:
        skipped += 1

conn.commit()
cursor.close()
conn.close()

print(f"✅ Inserted: {inserted} new Q&A pairs")
print(f"⏭️  Skipped: {skipped} duplicate Q&A pairs")