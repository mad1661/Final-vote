import { app, db } from "./firebase.js";

const status = document.getElementById("status");

if (app && db) {
  status.textContent = `Connected to Firebase project: ${app.options.projectId}`;
} else {
  status.textContent = "Failed to initialize Firebase.";
}
