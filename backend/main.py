from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import requests
import os
import fitz
import json
import math

from database import engine, SessionLocal
from models import Base, Message, Document, DocumentChunk, Assignment, StudyPlan

app = FastAPI()

Base.metadata.create_all(bind=engine)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def split_text(text, chunk_size=1000, overlap=200):
    chunks = []
    start = 0

    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]

        if chunk.strip():
            chunks.append(chunk)

        start += chunk_size - overlap

    return chunks


def get_embedding(text):
    response = requests.post(
        "http://localhost:11434/api/embeddings",
        json={"model": "nomic-embed-text", "prompt": text},
    )

    return response.json()["embedding"]


def cosine_similarity(vec1, vec2):
    dot = sum(a * b for a, b in zip(vec1, vec2))
    mag1 = math.sqrt(sum(a * a for a in vec1))
    mag2 = math.sqrt(sum(b * b for b in vec2))

    if mag1 == 0 or mag2 == 0:
        return 0

    return dot / (mag1 * mag2)


@app.get("/")
def home():
    return {"message": "Backend is working"}


@app.post("/chat")
def chat(data: dict):
    user_message = data.get("message", "")

    response = requests.post(
        "http://localhost:11434/api/generate",
        json={"model": "llama3.2", "prompt": user_message, "stream": False},
    )

    ai_text = response.json()["response"]

    db = SessionLocal()

    new_message = Message(user_message=user_message, ai_response=ai_text)

    db.add(new_message)
    db.commit()
    db.refresh(new_message)

    message_id = new_message.id

    db.close()

    return {"response": ai_text, "id": message_id}


@app.get("/history")
def get_history():
    db = SessionLocal()
    messages = db.query(Message).all()
    db.close()
    return messages


@app.post("/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    upload_folder = "../uploads"
    os.makedirs(upload_folder, exist_ok=True)

    file_path = os.path.join(upload_folder, file.filename)

    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    pdf = fitz.open(file_path)

    extracted_text = ""

    for page in pdf:
        extracted_text += page.get_text()

    pdf.close()

    db = SessionLocal()

    new_document = Document(
        filename=file.filename,
        file_path=file_path,
        text_preview=extracted_text[:2000],
        total_characters=len(extracted_text),
        full_text=extracted_text,
    )

    db.add(new_document)
    db.commit()
    db.refresh(new_document)

    chunks = split_text(extracted_text)

    for chunk in chunks:
        embedding = get_embedding(chunk)

        new_chunk = DocumentChunk(
            document_id=new_document.id,
            chunk_text=chunk,
            embedding=json.dumps(embedding),
        )

        db.add(new_chunk)

    db.commit()

    document_id = new_document.id
    filename = new_document.filename
    text_preview = new_document.text_preview
    total_characters = new_document.total_characters

    db.close()

    return {
        "id": document_id,
        "filename": filename,
        "text_preview": text_preview,
        "total_characters": total_characters,
        "message": "PDF uploaded. Now run analyzers from frontend.",
    }


@app.get("/documents")
def get_documents():
    db = SessionLocal()
    documents = db.query(Document).all()
    db.close()
    return documents


@app.post("/ask-document")
def ask_document(data: dict):
    document_id = data.get("document_id")
    question = data.get("question")

    db = SessionLocal()

    document = db.query(Document).filter(Document.id == document_id).first()

    if not document:
        db.close()
        return {"error": "Document not found"}

    question_embedding = get_embedding(question)

    chunks = (
        db.query(DocumentChunk).filter(DocumentChunk.document_id == document_id).all()
    )

    scored_chunks = []

    for chunk in chunks:
        chunk_embedding = json.loads(chunk.embedding)
        score = cosine_similarity(question_embedding, chunk_embedding)

        scored_chunks.append({"text": chunk.chunk_text, "score": score})

    scored_chunks.sort(key=lambda x: x["score"], reverse=True)

    top_chunks = scored_chunks[:3]

    context = "\n\n---\n\n".join(chunk["text"] for chunk in top_chunks)

    db.close()

    prompt = f"""
You are answering questions using only the document context below.

If the answer is not in the context, say:
"I could not find that in the document."

DOCUMENT CONTEXT:
{context}

QUESTION:
{question}

ANSWER:
"""

    response = requests.post(
        "http://localhost:11434/api/generate",
        json={"model": "llama3.2", "prompt": prompt, "stream": False},
    )

    return {"answer": response.json()["response"], "used_chunks": len(top_chunks)}


@app.post("/analyze-document")
def analyze_document(data: dict):
    document_id = data.get("document_id")

    db = SessionLocal()

    document = db.query(Document).filter(Document.id == document_id).first()

    if not document:
        db.close()
        return {"error": "Document not found"}

    all_chunks = (
        db.query(DocumentChunk).filter(DocumentChunk.document_id == document_id).all()
    )

    deadline_keywords = [
        "due",
        "deadline",
        "quiz",
        "exam",
        "test",
        "essay",
        "assignment",
        "project",
        "presentation",
        "reflection",
        "discussion",
        "submit",
        "submission",
        "schedule",
        "week",
        "lesson",
        "module",
        "grade",
        "marks",
        "percent",
        "opens",
        "closes",
        "available",
        "availability",
        "lesson 1",
        "lesson 2",
        "lesson 3",
        "lesson 4",
        "lessons 1",
        "lessons 5",
        "lessons 9",
        "quiz 1",
        "quiz 2",
        "quiz 3",
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
    ]

    keyword_chunks = []

    for chunk in all_chunks:
        lower_text = chunk.chunk_text.lower()

        if any(keyword in lower_text for keyword in deadline_keywords):
            keyword_chunks.append(chunk.chunk_text)

    selected_chunks = keyword_chunks[:15]
    context = "\n\n---\n\n".join(selected_chunks)

    if not context.strip():
        db.close()
        return {
            "assignments": [],
            "used_chunks": 0,
            "message": "No deadline-related chunks found.",
        }

    prompt = f"""
You are an academic deadline extraction tool.

Use ONLY the document context below.

Your job is to extract school deadlines from a syllabus or course document.

IMPORTANT RULES:
- Create ONE separate assignment object for EACH separate deadline.
- If there are multiple quizzes, create Quiz 1, Quiz 2, Quiz 3 as separate items.
- If there are multiple essays, create separate essay items.
- If there are multiple discussion deadlines, create separate discussion items.
- Do not combine multiple deadlines into one item.
- Do not invent dates.
- Only use "Unknown" if the date truly cannot be found.
- If an item has no due date, include it only if it is clearly graded or required.
- Prefer specific titles like "Quiz 1", "Quiz 2", "Essay", "Discussion Post" instead of "Unknown".
- If course code or course name appears, use it for the course field.

DATE MATCHING RULES:
- If a quiz appears in one section and due dates appear in a schedule section, match them together when possible.
- Look for schedule rows, weekly modules, lesson ranges, availability dates, and quiz due dates.
- If you see "Lessons 1-4 Quiz", treat it as Quiz 1 unless another quiz number is shown.
- If you see "Lessons 5-8 Quiz", treat it as Quiz 2 unless another quiz number is shown.
- If you see "Lessons 9-12 Quiz", treat it as Quiz 3 unless another quiz number is shown.
- Do not write "No specific due date mentioned" if a date appears nearby.

INCLUDE:
- assignments
- essays
- reflections
- quizzes
- exams
- tests
- projects
- presentations
- discussion posts
- submission deadlines

DO NOT INCLUDE:
- accessibility policy
- plagiarism policy
- AI policy
- office hours
- general course description
- technical requirements
- random readings unless they have a due date

RETURN ONLY this JSON object:

{{
  "assignments": [
    {{
      "course": "course name if found, otherwise Unknown",
      "title": "specific assignment, quiz, exam, project, or deadline name",
      "due_date": "exact date or date text from the document, otherwise Unknown",
      "description": "short explanation of what is due"
    }}
  ]
}}

If no deadlines are found, return:

{{
  "assignments": []
}}

DOCUMENT CONTEXT:
{context}
"""

    response = requests.post(
        "http://localhost:11434/api/generate",
        json={"model": "llama3.2", "prompt": prompt, "stream": False, "format": "json"},
    )

    ai_text = response.json()["response"].strip()

    try:
        parsed = json.loads(ai_text)
        extracted_items = parsed.get("assignments", [])
    except Exception:
        db.close()
        return {"error": "AI did not return valid JSON", "raw_response": ai_text}

    saved_assignments = []

    for item in extracted_items:
        course = item.get("course", "Unknown")
        title = item.get("title", "Unknown")
        due_date = item.get("due_date", "Unknown")
        description = item.get("description", "")

        existing_assignment = (
            db.query(Assignment)
            .filter(
                Assignment.source_document_id == document.id,
                Assignment.title == title,
                Assignment.due_date == due_date,
            )
            .first()
        )

        if existing_assignment:
            saved_assignments.append(
                {
                    "id": existing_assignment.id,
                    "course": existing_assignment.course,
                    "title": existing_assignment.title,
                    "due_date": existing_assignment.due_date,
                    "description": existing_assignment.description,
                    "status": existing_assignment.status,
                    "duplicate": True,
                }
            )
            continue

        new_assignment = Assignment(
            course=course,
            title=title,
            due_date=due_date,
            description=description,
            source_document_id=document.id,
            status="not started",
        )

        db.add(new_assignment)
        db.commit()
        db.refresh(new_assignment)

        saved_assignments.append(
            {
                "id": new_assignment.id,
                "course": new_assignment.course,
                "title": new_assignment.title,
                "due_date": new_assignment.due_date,
                "description": new_assignment.description,
                "status": new_assignment.status,
                "duplicate": False,
            }
        )

    db.close()

    return {"assignments": saved_assignments, "used_chunks": len(selected_chunks)}


@app.post("/analyze-quizzes")
def analyze_quizzes(data: dict):
    document_id = data.get("document_id")

    db = SessionLocal()

    document = db.query(Document).filter(Document.id == document_id).first()

    if not document:
        db.close()
        return {"error": "Document not found"}

    all_chunks = (
        db.query(DocumentChunk)
        .filter(DocumentChunk.document_id == document_id)
        .all()
    )

    quiz_chunks = []

    for chunk in all_chunks:
        lower_text = chunk.chunk_text.lower()

        if (
            "quiz" in lower_text
            or "lessons 1" in lower_text
            or "lessons 5" in lower_text
            or "lessons 9" in lower_text
            or "multiple-choice" in lower_text
        ):
            quiz_chunks.append(chunk.chunk_text)

    context = "\n\n---\n\n".join(quiz_chunks[:10])

    prompt = f"""
You are a quiz deadline extraction tool.

Use ONLY the document context below.

Extract every quiz separately.

Return ONLY this JSON object:

{{
  "assignments": [
    {{
      "course": "course name if found, otherwise Unknown",
      "title": "Quiz 1, Quiz 2, Quiz 3, etc.",
      "due_date": "exact due date from the document, otherwise Unknown",
      "description": "short explanation of the quiz"
    }}
  ]
}}

Rules:
- Do not combine quizzes.
- If there are three quizzes, return three separate objects.
- Match lesson ranges to quiz numbers when possible:
  - Lessons 1-4 = Quiz 1
  - Lessons 5-8 = Quiz 2
  - Lessons 9-12 = Quiz 3
- Do not invent dates.
- If no quizzes are found, return {{ "assignments": [] }}.

DOCUMENT CONTEXT:
{context}
"""

    response = requests.post(
        "http://localhost:11434/api/generate",
        json={
            "model": "llama3.2",
            "prompt": prompt,
            "stream": False,
            "format": "json",
        },
    )

    ai_text = response.json()["response"].strip()

    try:
        parsed = json.loads(ai_text)
        extracted_items = parsed.get("assignments", [])
    except Exception:
        db.close()
        return {
            "error": "AI did not return valid JSON",
            "raw_response": ai_text,
        }

    # If analyze-document already found the real course name, use it for quizzes
    # when the quiz extractor returns "Unknown".
    existing_course_assignment = (
        db.query(Assignment)
        .filter(
            Assignment.source_document_id == document.id,
            Assignment.course != "Unknown",
        )
        .first()
    )

    document_course = (
        existing_course_assignment.course
        if existing_course_assignment
        else "Unknown"
    )

    saved_assignments = []

    for item in extracted_items:
        course = item.get("course", "Unknown")

        if course == "Unknown":
            course = document_course

        title = item.get("title", "Unknown")
        due_date = item.get("due_date", "Unknown")
        description = item.get("description", "")

        existing_assignment = (
            db.query(Assignment)
            .filter(
                Assignment.source_document_id == document.id,
                Assignment.title == title,
                Assignment.due_date == due_date,
            )
            .first()
        )

        if existing_assignment:
            # If this already exists but has Unknown course, fix it now.
            if existing_assignment.course == "Unknown" and course != "Unknown":
                existing_assignment.course = course
                db.commit()
                db.refresh(existing_assignment)

            saved_assignments.append(
                {
                    "id": existing_assignment.id,
                    "course": existing_assignment.course,
                    "title": existing_assignment.title,
                    "due_date": existing_assignment.due_date,
                    "description": existing_assignment.description,
                    "status": existing_assignment.status,
                    "duplicate": True,
                }
            )
            continue

        new_assignment = Assignment(
            course=course,
            title=title,
            due_date=due_date,
            description=description,
            source_document_id=document.id,
            status="not started",
        )

        db.add(new_assignment)
        db.commit()
        db.refresh(new_assignment)

        saved_assignments.append(
            {
                "id": new_assignment.id,
                "course": new_assignment.course,
                "title": new_assignment.title,
                "due_date": new_assignment.due_date,
                "description": new_assignment.description,
                "status": new_assignment.status,
                "duplicate": False,
            }
        )

    # Final cleanup: if any assignments from this document still say Unknown
    # but another assignment from the same document has the real course,
    # update the Unknown ones to match.
    real_course_assignment = (
        db.query(Assignment)
        .filter(
            Assignment.source_document_id == document.id,
            Assignment.course != "Unknown",
        )
        .first()
    )

    if real_course_assignment:
        real_course = real_course_assignment.course

        unknown_assignments = (
            db.query(Assignment)
            .filter(
                Assignment.source_document_id == document.id,
                Assignment.course == "Unknown",
            )
            .all()
        )

        for assignment in unknown_assignments:
            assignment.course = real_course

        db.commit()

    db.close()

    return {
        "assignments": saved_assignments,
        "used_chunks": len(quiz_chunks[:10]),
    }


@app.get("/assignments")
def get_assignments():
    db = SessionLocal()
    assignments = db.query(Assignment).all()
    db.close()
    return assignments


@app.post("/update-assignment-status")
def update_assignment_status(data: dict):
    assignment_id = data.get("assignment_id")
    status = data.get("status")

    db = SessionLocal()

    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()

    if not assignment:
        db.close()
        return {"error": "Assignment not found"}

    assignment.status = status

    db.commit()
    db.refresh(assignment)

    db.close()

    return {"success": True, "id": assignment.id, "status": assignment.status}


@app.post("/generate-study-plan")
def generate_study_plan(data: dict):
    assignment_id = data.get("assignment_id")

    db = SessionLocal()

    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()

    if not assignment:
        db.close()
        return {"error": "Assignment not found"}

    prompt = f"""
You are an academic planning assistant.

Create a practical study/work plan for this assignment.

Assignment:
Title: {assignment.title}
Course: {assignment.course}
Due Date: {assignment.due_date}
Description: {assignment.description}
Current Status: {assignment.status}

Make the plan simple, realistic, and organized.
Use bullet points.
Include what to do first, what to do next, and what to do before submitting.
"""

    response = requests.post(
        "http://localhost:11434/api/generate",
        json={"model": "llama3.2", "prompt": prompt, "stream": False},
    )

    plan_text = response.json()["response"]

    existing_plan = (
        db.query(StudyPlan).filter(StudyPlan.assignment_id == assignment_id).first()
    )

    if existing_plan:
        existing_plan.plan_text = plan_text
        db.commit()
        db.refresh(existing_plan)

        plan_id = existing_plan.id
    else:
        new_plan = StudyPlan(assignment_id=assignment.id, plan_text=plan_text)

        db.add(new_plan)
        db.commit()
        db.refresh(new_plan)

        plan_id = new_plan.id

    db.close()

    return {"id": plan_id, "assignment_id": assignment_id, "plan_text": plan_text}


@app.get("/study-plans")
def get_study_plans():
    db = SessionLocal()
    plans = db.query(StudyPlan).all()
    db.close()
    return plans

@app.post("/delete-assignment")
def delete_assignment(data: dict):
    assignment_id = data.get("assignment_id")

    db = SessionLocal()

    assignment = (
        db.query(Assignment)
        .filter(Assignment.id == assignment_id)
        .first()
    )

    if not assignment:
        db.close()
        return {"error": "Assignment not found"}

    db.delete(assignment)
    db.commit()

    db.close()

    return {"message": "Assignment deleted"}

@app.post("/create-assignment")
def create_assignment(data: dict):
    course = data.get("course", "Unknown")
    title = data.get("title", "Untitled Assignment")
    due_date = data.get("due_date", "Unknown")
    description = data.get("description", "")

    db = SessionLocal()

    new_assignment = Assignment(
        course=course,
        title=title,
        due_date=due_date,
        description=description,
        source_document_id=None,
        status="not started",
    )

    db.add(new_assignment)
    db.commit()
    db.refresh(new_assignment)

    assignment_data = {
        "id": new_assignment.id,
        "course": new_assignment.course,
        "title": new_assignment.title,
        "due_date": new_assignment.due_date,
        "description": new_assignment.description,
        "status": new_assignment.status,
    }

    db.close()

    return assignment_data