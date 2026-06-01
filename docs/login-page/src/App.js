import './App.css'
import Login from './pages/login/Login'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

function App() {
    return (
        <div className="App">
            <Login />
            <ToastContainer closeButton={false} position="top-right" />
        </div>
    )
}

export default App
