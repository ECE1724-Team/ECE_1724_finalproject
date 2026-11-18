import ApplicationForm from "@/components/ApplicationForm";
import NavBar from "@/components/NavBar";

export default function Application() {
    return (<>
        <NavBar currentLocation="/applications" />
        <div>
            <h1>Applications</h1>
            <ApplicationForm />
        </div>
    </>
    );
}
