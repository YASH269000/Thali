import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import FamilyProfile from './components/FamilyProfile.jsx'
import MealPlan from './components/MealPlan.jsx'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<FamilyProfile />} />
        <Route path="/meal-plan" element={<MealPlan />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
