package pt.keepaligner.notaspro;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KeepSharePlugin.class);
        registerPlugin(KeepInsetsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
