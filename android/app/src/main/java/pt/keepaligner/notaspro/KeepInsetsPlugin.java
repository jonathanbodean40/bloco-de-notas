package pt.keepaligner.notaspro;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Read real Android system-bar insets (in CSS dp) for the edge-to-edge WebView. */
@CapacitorPlugin(name = "KeepInsets")
public class KeepInsetsPlugin extends Plugin {
    @PluginMethod
    public void getInsets(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(getActivity().getWindow().getDecorView());
                if (insets == null) {
                    call.reject("System insets unavailable");
                    return;
                }
                Insets topBar = insets.getInsets(WindowInsetsCompat.Type.statusBars());
                Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
                Insets bottomBar = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
                float density = getContext().getResources().getDisplayMetrics().density;
                if (density <= 0) density = 1f;
                JSObject values = new JSObject();
                values.put("top", Math.min(96, Math.max(0, (int) Math.ceil(Math.max(topBar.top, cutout.top) / density))));
                values.put("bottom", Math.min(96, Math.max(0, (int) Math.ceil(bottomBar.bottom / density))));
                call.resolve(values);
            } catch (Exception error) {
                call.reject("Unable to read system insets");
            }
        });
    }
}
