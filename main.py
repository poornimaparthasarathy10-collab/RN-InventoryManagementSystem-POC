import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from inventory_crew import rn_agencies_crew

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/run-audit")
def trigger_agent_audit():
    try:
        print("⚡ Live UI Request Received! Activating Agent Squad...")
        result = rn_agencies_crew.kickoff()
        return {"status": "success", "agent_report": str(result)}
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
